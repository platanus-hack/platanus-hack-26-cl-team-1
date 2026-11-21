/** flashArtifact (Web Serial) and downloadArtifact. */
import type { BoardId, CompileResult } from '@/contracts';
import { getBoardProfile } from '@/catalog';
import { espFlashOffset, looksLikeEspImage, trimTrailingFF } from './binutil';
import { defaultArtifactFilename, filenameFromDisposition } from './client';
import { FlashError, toFlashError } from './errors';
import { IntelHexError, parseIntelHex, type HexImage } from './intelhex';
import { ESP32_FILTERS, requestSerialPort, UNO_FILTERS } from './serial';
import { useFlash } from './store';

export const webSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

const UNSUPPORTED = () =>
  new FlashError('unsupported', 'Tu navegador no permite cargar programas por USB.', 'Usa Google Chrome o Microsoft Edge en un computador.');

async function fetchArtifact(result: CompileResult): Promise<Uint8Array> {
  if (!result.artifactUrl) throw new FlashError('artifact', 'Esta compilación no tiene un binario para cargar.', 'Compila el programa de nuevo.');
  let res: Response;
  try {
    res = await fetch(result.artifactUrl, { cache: 'no-store' });
  } catch {
    throw new FlashError('artifact', 'No se pudo descargar el binario desde el servidor.', 'Revisa la conexión y vuelve a intentarlo.');
  }
  if (!res.ok) throw new FlashError('artifact', 'El binario ya no está disponible en el servidor.', 'Vuelve a compilar el programa (los binarios duran 1 hora).');
  return new Uint8Array(await res.arrayBuffer());
}

function parseHex(bytes: Uint8Array): HexImage {
  try {
    return parseIntelHex(new TextDecoder().decode(bytes));
  } catch (err) {
    throw new FlashError('artifact', err instanceof IntelHexError ? err.message : 'El archivo .hex no es válido.', 'Vuelve a compilar el programa.');
  }
}

let flashing = false;

/** Flash a compiled artifact to a board over Web Serial (asks the user to pick the port). Call it from a click. */
export async function flashArtifact(result: CompileResult, board: BoardId, onProgress?: (fraction: number, message: string) => void): Promise<void> {
  const report = (fraction: number, message: string) => {
    useFlash.setState({ phase: 'flashing', fraction, message, error: null, jobId: result.jobId });
    onProgress?.(fraction, message);
  };
  if (flashing) throw new FlashError('busy', 'Ya hay una carga en curso.');
  flashing = true;
  try {
    if (!webSerialSupported()) throw UNSUPPORTED();
    if (result.status !== 'success') throw new FlashError('artifact', 'Primero compila el programa sin errores.');
    if (result.board !== board) {
      throw new FlashError('wrong-board', 'El binario se compiló para otra placa.', 'Vuelve a compilar para la placa del proyecto.');
    }
    const profile = getBoardProfile(board);
    const isUno = profile.upload.protocol === 'stk500v1';
    // Pick the port FIRST, while the click's user activation is still valid.
    const port = await requestSerialPort(isUno ? UNO_FILTERS : ESP32_FILTERS);
    report(0, 'Descargando el binario…');
    const bytes = await fetchArtifact(result);

    if (isUno) {
      const image = parseHex(bytes);
      const { flashUno } = await import('./stk500');
      await flashUno(port, image, profile.upload.baud, report);
    } else {
      if (!looksLikeEspImage(bytes)) throw new FlashError('artifact', 'El binario del ESP32 no es válido.', 'Vuelve a compilar el programa.');
      const address = espFlashOffset(result.artifactName, profile);
      const data = address === 0 ? trimTrailingFF(bytes) : bytes;
      const { flashEsp32 } = await import('./esp');
      await flashEsp32(port, { data, address, board: profile, onProgress: report });
    }
    useFlash.setState({ phase: 'done', fraction: 1, message: '¡Programa cargado en la placa!', error: null, jobId: result.jobId });
  } catch (err) {
    const fe = toFlashError(err);
    const cancelled = fe.code === 'cancelled';
    useFlash.setState({
      phase: cancelled ? 'idle' : 'error',
      fraction: 0,
      message: '',
      error: cancelled ? null : { message: fe.message, hint: fe.hint, code: fe.code },
      jobId: result.jobId,
    });
    throw fe;
  } finally {
    flashing = false;
  }
}

/** Fetch the artifact and save it with the server's file name (circuito-vivo-uno.hex…). */
export async function downloadArtifactAsync(result: CompileResult): Promise<void> {
  if (!result.artifactUrl) throw new Error('Esta compilación no tiene un binario para descargar.');
  let res: Response;
  try {
    res = await fetch(result.artifactUrl, { cache: 'no-store' });
  } catch {
    throw new Error('No se pudo descargar el binario: el servidor no responde.');
  }
  if (!res.ok) throw new Error('El binario ya no está disponible. Vuelve a compilar el programa.');
  const name = filenameFromDisposition(res.headers.get('content-disposition')) ?? defaultArtifactFilename(result);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Fire-and-forget download (falls back to opening the URL). */
export function downloadArtifact(result: CompileResult): void {
  downloadArtifactAsync(result).catch((err: unknown) => {
    console.warn('[flash] download failed', err);
    if (result.artifactUrl) window.open(result.artifactUrl, '_blank', 'noopener');
  });
}

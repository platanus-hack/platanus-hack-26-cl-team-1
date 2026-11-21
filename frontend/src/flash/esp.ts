/** ESP32-C6 flashing through esptool-js 0.7 (Transport + ESPLoader over Web Serial). */
import type { BoardProfile } from '@/contracts';
import { FlashError, toFlashError } from './errors';
import { closePortQuietly } from './serial';
import type { ProgressFn } from './stk500';

const BOOT_HINT =
  'Mantén presionado el botón BOOT de la placa, presiona y suelta RESET (o desconecta y reconecta el USB) y luego suelta BOOT. Después vuelve a intentarlo.';

function espError(err: unknown, log: string[]): FlashError {
  if (err instanceof FlashError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const tail = log.slice(-6).join(' ');
  if (/Failed to connect|Couldn't sync|Invalid head of packet|sync|Timeout/i.test(msg + ' ' + tail) && !/open/i.test(msg)) {
    return new FlashError('no-sync', 'No se pudo conectar con el ESP32-C6.', BOOT_HINT);
  }
  return toFlashError(err, BOOT_HINT);
}

export interface EspFlashOptions {
  data: Uint8Array;
  address: number;
  board: BoardProfile;
  onProgress?: ProgressFn;
}

/** Flash `data` at `address`. The port must be selected (not open); it is closed at the end. */
export async function flashEsp32(port: SerialPort, opts: EspFlashOptions): Promise<void> {
  const { data, address, board, onProgress } = opts;
  const baud = board.upload.baud;
  const expectedChip = board.upload.protocol === 'esptool' ? board.upload.chip : 'ESP32';
  const log: string[] = [];
  const terminal = {
    clean: () => undefined,
    write: (s: string) => void log.push(s),
    writeLine: (s: string) => void log.push(s),
  };

  onProgress?.(0.01, 'Preparando el cargador del ESP32…');
  const { ESPLoader, Transport } = await import('esptool-js');
  const transport = new Transport(port, false);
  try {
    const loader = new ESPLoader({ transport, baudrate: baud, romBaudrate: 115200, terminal, debugLogging: false });
    onProgress?.(0.03, 'Conectando con la placa (modo de carga)…');
    await loader.main('default_reset');
    const chipName = loader.chip?.CHIP_NAME ?? '';
    if (expectedChip && chipName && chipName.replace(/[^a-z0-9]/gi, '').toLowerCase() !== expectedChip.replace(/[^a-z0-9]/gi, '').toLowerCase()) {
      throw new FlashError('wrong-board', `La placa conectada es un ${chipName}, no un ${expectedChip}.`, 'Elige el puerto correcto o cambia la placa del proyecto y vuelve a compilar.');
    }
    onProgress?.(0.1, 'Borrando y escribiendo la memoria…');
    await loader.writeFlash({
      fileArray: [{ data, address }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_index, written, total) => {
        const f = total > 0 ? written / total : 0;
        onProgress?.(0.1 + 0.85 * f, `Escribiendo ${Math.round(f * 100)} %…`);
      },
    });
    onProgress?.(0.97, 'Reiniciando la placa…');
    await loader.after('hard_reset');
    onProgress?.(1, '¡Programa cargado!');
  } catch (err) {
    console.warn('[flash] esptool log:', log.join('\n'));
    throw espError(err, log);
  } finally {
    try {
      await transport.disconnect();
    } catch {
      /* already closed */
    }
    await closePortQuietly(port);
  }
}

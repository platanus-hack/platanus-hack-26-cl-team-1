/**
 * STK500v1 programmer for the Arduino Uno bootloader (optiboot) over Web Serial.
 * Pure packet builders + a protocol driver over the `ByteIO` interface (unit-testable with a fake device).
 */
import { FlashError, TimeoutError, toFlashError } from './errors';
import { toPages, type HexImage } from './intelhex';
import { closePortQuietly, sleep, SerialByteIO, type ByteIO } from './serial';

export const STK = {
  OK: 0x10,
  FAILED: 0x11,
  INSYNC: 0x14,
  NOSYNC: 0x15,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
} as const;

/** ATmega328P page size in bytes. */
export const UNO_PAGE_SIZE = 128;
/** Signatures accepted as "Arduino Uno compatible" (328P, 328, 328PB). */
export const ATMEGA328_SIGNATURES = ['1e950f', '1e9514', '1e9516'];

export type ProgressFn = (fraction: number, message: string) => void;

/* ------------------------------------------------------------------ packets */

const pkt = (...bytes: number[]) => Uint8Array.from([...bytes, STK.CRC_EOP]);

export const cmdGetSync = () => pkt(STK.GET_SYNC);
export const cmdReadSignature = () => pkt(STK.READ_SIGN);
export const cmdEnterProgmode = () => pkt(STK.ENTER_PROGMODE);
export const cmdLeaveProgmode = () => pkt(STK.LEAVE_PROGMODE);

/** Load address: the bootloader takes a WORD address (byte address / 2), little-endian. */
export function cmdLoadAddress(byteAddress: number): Uint8Array {
  const word = byteAddress >> 1;
  return pkt(STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff);
}

/** Program page: size big-endian, memory type 'F' (flash), data. */
export function cmdProgramPage(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 5);
  out[0] = STK.PROG_PAGE;
  out[1] = (data.length >> 8) & 0xff;
  out[2] = data.length & 0xff;
  out[3] = 0x46; // 'F'
  out.set(data, 4);
  out[out.length - 1] = STK.CRC_EOP;
  return out;
}

export function cmdReadPage(size: number): Uint8Array {
  return pkt(STK.READ_PAGE, (size >> 8) & 0xff, size & 0xff, 0x46);
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/* ------------------------------------------------------------------ protocol */

const NO_SYNC_HINT =
  'Revisa que elegiste el puerto del Arduino Uno y que no lo esté usando otro programa. Si sigue fallando, desconecta y vuelve a conectar el cable USB.';

export class Stk500 {
  constructor(private readonly io: ByteIO) {}

  /** Read INSYNC, `extra` payload bytes, OK. Returns the payload. */
  private async response(extra: number, timeoutMs: number, what: string): Promise<Uint8Array> {
    const first = await this.io.read(1, timeoutMs);
    if (first[0] !== STK.INSYNC) {
      throw new FlashError('no-sync', `La placa perdió la sincronización (${what}).`, NO_SYNC_HINT);
    }
    const payload = extra > 0 ? await this.io.read(extra, timeoutMs) : new Uint8Array(0);
    const last = await this.io.read(1, timeoutMs);
    if (last[0] !== STK.OK) throw new FlashError('failed', `La placa rechazó el comando (${what}).`);
    return payload;
  }

  private async command(packet: Uint8Array, extra: number, timeoutMs: number, what: string): Promise<Uint8Array> {
    await this.io.write(packet);
    try {
      return await this.response(extra, timeoutMs, what);
    } catch (err) {
      if (err instanceof TimeoutError) throw new FlashError('no-sync', `La placa dejó de responder (${what}).`, NO_SYNC_HINT);
      throw err;
    }
  }

  /** GET_SYNC until the bootloader answers INSYNC OK. */
  async sync(attempts = 10, timeoutMs = 250): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      await this.io.drain(i === 0 ? 10 : 30);
      await this.io.write(cmdGetSync());
      try {
        const r = await this.io.read(2, timeoutMs);
        if (r[0] === STK.INSYNC && r[1] === STK.OK) {
          await this.io.drain(5);
          return true;
        }
      } catch (err) {
        if (!(err instanceof TimeoutError)) throw err;
      }
    }
    return false;
  }

  async readSignature(): Promise<string> {
    return hex(await this.command(cmdReadSignature(), 3, 500, 'leer firma'));
  }

  async enterProgmode(): Promise<void> {
    await this.command(cmdEnterProgmode(), 0, 500, 'modo programación');
  }

  async leaveProgmode(): Promise<void> {
    await this.command(cmdLeaveProgmode(), 0, 500, 'salir de programación');
  }

  async writePage(address: number, data: Uint8Array): Promise<void> {
    await this.command(cmdLoadAddress(address), 0, 500, 'dirección');
    await this.command(cmdProgramPage(data), 0, 1500, 'escribir página');
  }

  async readPage(address: number, size: number): Promise<Uint8Array> {
    await this.command(cmdLoadAddress(address), 0, 500, 'dirección');
    return this.command(cmdReadPage(size), size, 1500, 'leer página');
  }
}

export interface ProgramOptions {
  onProgress?: ProgressFn;
  verify?: boolean;
  pageSize?: number;
  /** Already-synced? (flashUno syncs itself during the reset handshake.) */
  skipSync?: boolean;
}

/** Program a flat image through an STK500v1 bootloader (assumes the board was just reset). */
export async function programStk500(io: ByteIO, image: HexImage, opts: ProgramOptions = {}): Promise<{ signature: string; pages: number }> {
  const { onProgress, verify = true, pageSize = UNO_PAGE_SIZE } = opts;
  const stk = new Stk500(io);
  if (!opts.skipSync) {
    onProgress?.(0.04, 'Sincronizando con la placa…');
    if (!(await stk.sync())) throw new FlashError('no-sync', 'La placa no respondió.', NO_SYNC_HINT);
  }
  const signature = await stk.readSignature();
  if (!ATMEGA328_SIGNATURES.includes(signature)) {
    throw new FlashError('wrong-board', `La placa conectada no parece un Arduino Uno (firma ${signature}).`, 'Elige el puerto de un Arduino Uno o cambia la placa en el proyecto.');
  }
  await stk.enterProgmode();
  const pages = toPages(image, pageSize);
  const writeSpan = verify ? 0.62 : 0.88;
  for (let i = 0; i < pages.length; i++) {
    await stk.writePage(pages[i].address, pages[i].data);
    onProgress?.(0.08 + writeSpan * ((i + 1) / pages.length), `Escribiendo ${i + 1} de ${pages.length} páginas…`);
  }
  if (verify) {
    for (let i = 0; i < pages.length; i++) {
      const read = await stk.readPage(pages[i].address, pageSize);
      const want = pages[i].data;
      for (let b = 0; b < pageSize; b++) {
        if (read[b] !== want[b]) {
          throw new FlashError('failed', `La verificación falló en la dirección 0x${(pages[i].address + b).toString(16)}.`, 'Vuelve a intentar la carga; si se repite, prueba con otro cable USB.');
        }
      }
      onProgress?.(0.7 + 0.26 * ((i + 1) / pages.length), `Verificando ${i + 1} de ${pages.length} páginas…`);
    }
  }
  await stk.leaveProgmode();
  return { signature, pages: pages.length };
}

/** Toggle DTR/RTS: the Uno's auto-reset circuit restarts the ATmega into optiboot. */
async function resetBoard(port: SerialPort): Promise<void> {
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await sleep(50);
  await port.setSignals({ dataTerminalReady: true, requestToSend: true });
  await sleep(50);
}

/** Flash an Arduino Uno through an already-selected (closed) Web Serial port. Closes the port. */
export async function flashUno(port: SerialPort, image: HexImage, baud: number, onProgress?: ProgressFn): Promise<void> {
  let io: SerialByteIO | null = null;
  try {
    onProgress?.(0.01, 'Abriendo el puerto USB…');
    try {
      await port.open({ baudRate: baud, bufferSize: 4096 });
    } catch (err) {
      throw toFlashError(err);
    }
    io = new SerialByteIO(port);
    const stk = new Stk500(io);
    let synced = false;
    for (let cycle = 0; cycle < 2 && !synced; cycle++) {
      onProgress?.(0.02, cycle === 0 ? 'Reiniciando la placa…' : 'Reintentando el reinicio…');
      await resetBoard(port);
      onProgress?.(0.04, 'Sincronizando con la placa…');
      synced = await stk.sync();
    }
    if (!synced) throw new FlashError('no-sync', 'El Arduino Uno no respondió al reiniciarlo.', NO_SYNC_HINT);
    await programStk500(io, image, { onProgress, verify: true, skipSync: true });
    onProgress?.(1, '¡Programa cargado!');
  } catch (err) {
    throw toFlashError(err, NO_SYNC_HINT);
  } finally {
    await io?.close();
    await closePortQuietly(port);
  }
}

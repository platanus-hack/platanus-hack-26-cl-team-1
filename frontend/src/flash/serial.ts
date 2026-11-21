/** Web Serial helpers: port picker with USB filters and a buffered byte reader with timeouts. */
import { FlashError, TimeoutError, toFlashError } from './errors';

/** USB vendor ids of common Arduino / ESP32 USB-serial bridges. */
export const USB_VENDORS = {
  arduino: 0x2341,
  arduinoOrg: 0x2a03,
  ch340: 0x1a86,
  ftdi: 0x0403,
  cp210x: 0x10c4,
  espressif: 0x303a,
} as const;

export const UNO_FILTERS: SerialPortFilter[] = [
  { usbVendorId: USB_VENDORS.arduino },
  { usbVendorId: USB_VENDORS.arduinoOrg },
  { usbVendorId: USB_VENDORS.ch340 },
  { usbVendorId: USB_VENDORS.ftdi },
  { usbVendorId: USB_VENDORS.cp210x },
];

export const ESP32_FILTERS: SerialPortFilter[] = [
  { usbVendorId: USB_VENDORS.espressif },
  { usbVendorId: USB_VENDORS.cp210x },
  { usbVendorId: USB_VENDORS.ch340 },
  { usbVendorId: USB_VENDORS.ftdi },
];

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Opens the browser's port picker. MUST be called from a user gesture (click). */
export async function requestSerialPort(filters: SerialPortFilter[]): Promise<SerialPort> {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) {
    throw new FlashError('unsupported', 'Tu navegador no permite cargar programas por USB.', 'Usa Google Chrome o Microsoft Edge en un computador.');
  }
  try {
    return await navigator.serial.requestPort({ filters });
  } catch (err) {
    throw toFlashError(err);
  }
}

/** Minimal byte transport used by the STK500 programmer (mockable in tests). */
export interface ByteIO {
  write(data: Uint8Array): Promise<void>;
  /** Exactly `n` bytes, or throws TimeoutError. */
  read(n: number, timeoutMs: number): Promise<Uint8Array>;
  /** Discard everything received so far (waits `quietMs` for stragglers). */
  drain(quietMs?: number): Promise<void>;
}

/** ByteIO over an OPEN Web Serial port (background read loop into a buffer). */
export class SerialByteIO implements ByteIO {
  private buffer: number[] = [];
  private notify: (() => void) | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null;
  private closed = false;
  private failure: unknown = null;
  private loop: Promise<void>;

  constructor(port: SerialPort) {
    if (!port.readable || !port.writable) throw new FlashError('busy', 'El puerto USB no está abierto.');
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.loop = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) for (const b of value) this.buffer.push(b);
        this.notify?.();
      }
    } catch (err) {
      if (!this.closed) this.failure = err;
    } finally {
      this.notify?.();
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new FlashError('lost', 'El puerto USB se cerró.');
    await this.writer.write(data);
  }

  async read(n: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < n) {
      if (this.failure) throw toFlashError(this.failure);
      const left = deadline - Date.now();
      if (left <= 0) throw new TimeoutError();
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          this.notify = null;
          resolve();
        }, left);
        this.notify = () => {
          clearTimeout(t);
          this.notify = null;
          resolve();
        };
      });
    }
    return Uint8Array.from(this.buffer.splice(0, n));
  }

  async drain(quietMs = 20): Promise<void> {
    await sleep(quietMs);
    this.buffer = [];
  }

  /** Release the stream locks (the caller closes the port). */
  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* already released */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    this.reader = null;
    this.writer = null;
    await this.loop.catch(() => undefined);
  }
}

/** Close a port, ignoring "already closed" errors. */
export async function closePortQuietly(port: SerialPort): Promise<void> {
  try {
    await port.close();
  } catch {
    /* ignore */
  }
}

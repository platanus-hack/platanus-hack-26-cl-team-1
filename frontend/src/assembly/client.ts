/**
 * WebSocket client of the Modo Armado vision server.
 *  - Sends `hello` on every (re)connect (with `resume` so a reconnect keeps the current step).
 *  - Reconnects with exponential backoff (0.5 s → 8 s) until close() is called.
 *  - Frame backpressure: at most ONE frame in flight. A frame is acknowledged by the
 *    server's `debug` message with the same seq; no frame is sent while the previous one
 *    is unacknowledged (unless it is older than ackTimeoutMs) or while
 *    bufferedAmount > maxBuffered (256 KB).
 */
import { type ClientMsg, type HelloMsg, type ServerMsg, decodeAudio, encodeFrame } from './protocol';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** The subset of WebSocket the client uses (so tests can fake it). */
export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

export interface ClientOptions {
  url: string;
  hello: () => HelloMsg;
  onMessage: (m: ServerMsg) => void;
  onAudio: (id: string, audio: ArrayBuffer) => void;
  onStatus: (s: ConnStatus, info: { attempt: number; retryInMs?: number }) => void;
  socketFactory?: (url: string) => SocketLike;
  now?: () => number;
  maxBuffered?: number;
  ackTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

const OPEN = 1;

export class AssemblyClient {
  private ws: SocketLike | null = null;
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private inFlight: { seq: number; sentAt: number } | null = null;
  readonly stats = { sent: 0, skipped: 0, acked: 0, lastRttMs: 0 };
  private readonly o: Required<Omit<ClientOptions, 'socketFactory' | 'now'>> & {
    socketFactory: (url: string) => SocketLike;
    now: () => number;
  };

  constructor(opts: ClientOptions) {
    this.o = {
      maxBuffered: 256 * 1024,
      ackTimeoutMs: 2000,
      baseBackoffMs: 500,
      maxBackoffMs: 8000,
      socketFactory: (url) => new WebSocket(url) as unknown as SocketLike,
      now: () => performance.now(),
      ...opts,
    };
  }

  get status(): ConnStatus {
    if (this.stopped) return 'closed';
    if (this.ws?.readyState === OPEN) return 'open';
    return this.attempt > 0 ? 'reconnecting' : 'connecting';
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.o.onStatus('closed', { attempt: this.attempt });
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState !== OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** True when a new frame may be sent now (connection open, previous frame acked, socket not congested). */
  canSendFrame(): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    if (ws.bufferedAmount > this.o.maxBuffered) return false;
    if (this.inFlight && this.o.now() - this.inFlight.sentAt < this.o.ackTimeoutMs) return false;
    return true;
  }

  /** Sends one JPEG frame. Returns its seq, or null when skipped by backpressure. */
  sendFrame(jpeg: ArrayBuffer): number | null {
    if (!this.canSendFrame()) {
      this.stats.skipped++;
      return null;
    }
    const seq = ++this.seq;
    const now = this.o.now();
    this.ws!.send(encodeFrame(seq, Math.floor(now), jpeg));
    this.inFlight = { seq, sentAt: now };
    this.stats.sent++;
    return seq;
  }

  private open(): void {
    if (this.stopped) return;
    this.o.onStatus(this.attempt > 0 ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    let ws: SocketLike;
    try {
      ws = this.o.socketFactory(this.o.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.inFlight = null;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.o.hello()));
      this.o.onStatus('open', { attempt: this.attempt });
    };
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const delay = Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** this.attempt);
    this.attempt++;
    this.o.onStatus('reconnecting', { attempt: this.attempt, retryInMs: delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private handle(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const { id, audio } = decodeAudio(data);
      this.o.onAudio(id, audio);
      return;
    }
    if (typeof data !== 'string') return;
    let msg: ServerMsg;
    try {
      msg = JSON.parse(data) as ServerMsg;
    } catch {
      return;
    }
    if (msg.type === 'ready') this.attempt = 0;
    if (msg.type === 'debug' && this.inFlight && msg.seq >= this.inFlight.seq) {
      this.stats.acked++;
      this.stats.lastRttMs = this.o.now() - this.inFlight.sentAt;
      this.inFlight = null;
    }
    this.o.onMessage(msg);
  }
}

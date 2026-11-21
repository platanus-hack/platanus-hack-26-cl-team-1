import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssemblyClient, type ConnStatus, type SocketLike } from './client';
import type { HelloMsg, ServerMsg } from './protocol';
import { decodeAudio, encodeFrame } from './protocol';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent: Array<string | ArrayBuffer> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverSend(msg: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
  get json() {
    return this.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s));
  }
  get frames() {
    return this.sent.filter((s): s is ArrayBuffer => s instanceof ArrayBuffer);
  }
}

const hello = (resume?: HelloMsg['resume']): HelloMsg => ({
  type: 'hello',
  protocol: 1,
  project: {} as HelloMsg['project'],
  netlist: { nets: [], pinNet: {}, insertions: [] },
  steps: [],
  parts: {},
  record: false,
  debug: false,
  resume,
});

const ack = (seq: number): ServerMsg => ({ type: 'debug', seq, t_ms: 0, latency_ms: {} });

let now = 0;
function makeClient(extra: Partial<ConstructorParameters<typeof AssemblyClient>[0]> = {}) {
  const statuses: ConnStatus[] = [];
  const messages: ServerMsg[] = [];
  let current: HelloMsg['resume'];
  const client = new AssemblyClient({
    url: 'wss://x/ws/session',
    hello: () => hello(current),
    onMessage: (m) => messages.push(m),
    onAudio: () => {},
    onStatus: (s) => statuses.push(s),
    socketFactory: (u) => new FakeSocket(u),
    now: () => now,
    ...extra,
  });
  return { client, statuses, messages, setResume: (r: HelloMsg['resume']) => (current = r) };
}

beforeEach(() => {
  FakeSocket.all = [];
  now = 1000;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('protocol framing', () => {
  it('encodes seq and t_ms little-endian before the JPEG', () => {
    const buf = encodeFrame(258, 70000, new Uint8Array([0xff, 0xd8]).buffer);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(258);
    expect(dv.getUint32(4, true)).toBe(70000);
    expect([...new Uint8Array(buf, 8)]).toEqual([0xff, 0xd8]);
  });
  it('decodes an audio message with its id', () => {
    const bytes = new Uint8Array([3, 99, 49, 50, 82, 73, 70, 70]);
    const { id, audio } = decodeAudio(bytes.buffer);
    expect(id).toBe('c12');
    expect(new TextDecoder().decode(audio)).toBe('RIFF');
  });
});

describe('AssemblyClient', () => {
  it('sends hello on open', () => {
    const { client, statuses } = makeClient();
    client.connect();
    FakeSocket.all[0].serverOpen();
    expect(FakeSocket.all[0].json[0].type).toBe('hello');
    expect(statuses).toContain('open');
  });

  it('keeps one frame in flight until the server acks it', () => {
    const { client } = makeClient();
    client.connect();
    const ws = FakeSocket.all[0];
    ws.serverOpen();
    const jpeg = new Uint8Array([1, 2, 3]).buffer;
    expect(client.sendFrame(jpeg)).toBe(1);
    expect(client.sendFrame(jpeg)).toBeNull();
    expect(client.stats.skipped).toBe(1);
    now += 120;
    ws.serverSend(ack(1));
    expect(client.stats.lastRttMs).toBe(120);
    expect(client.sendFrame(jpeg)).toBe(2);
    expect(ws.frames).toHaveLength(2);
  });

  it('does not send while bufferedAmount exceeds 256 KB', () => {
    const { client } = makeClient();
    client.connect();
    const ws = FakeSocket.all[0];
    ws.serverOpen();
    ws.bufferedAmount = 300 * 1024;
    expect(client.sendFrame(new ArrayBuffer(10))).toBeNull();
    ws.bufferedAmount = 1000;
    expect(client.sendFrame(new ArrayBuffer(10))).toBe(1);
  });

  it('gives up waiting for a lost ack after ackTimeoutMs', () => {
    const { client } = makeClient({ ackTimeoutMs: 2000 });
    client.connect();
    FakeSocket.all[0].serverOpen();
    expect(client.sendFrame(new ArrayBuffer(4))).toBe(1);
    now += 1999;
    expect(client.canSendFrame()).toBe(false);
    now += 2;
    expect(client.sendFrame(new ArrayBuffer(4))).toBe(2);
  });

  it('reconnects with exponential backoff and resumes the current step', () => {
    const { client, setResume } = makeClient();
    client.connect();
    FakeSocket.all[0].serverOpen();
    setResume({ current: 3, status: { '1': 'done', '2': 'done', '3': 'active' } });
    FakeSocket.all[0].drop();
    expect(client.status).toBe('reconnecting');
    vi.advanceTimersByTime(499);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].drop(); // second failure → 1 s
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    const ws = FakeSocket.all[2];
    ws.serverOpen();
    expect(ws.json[0].resume.current).toBe(3);
    ws.serverSend({ type: 'ready', calibrated: false, session: 's', voice: null });
    ws.drop(); // backoff resets after `ready`
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('caps the backoff at 8 s and stops after close()', () => {
    const { client } = makeClient();
    client.connect();
    for (let i = 0; i < 6; i++) {
      FakeSocket.all.at(-1)!.drop();
      vi.advanceTimersByTime(8000);
    }
    const n = FakeSocket.all.length;
    FakeSocket.all.at(-1)!.drop();
    vi.advanceTimersByTime(7999);
    expect(FakeSocket.all).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(n + 1);
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(n + 1);
    expect(client.status).toBe('closed');
  });

  it('a frame sent before a reconnect does not block the new connection', () => {
    const { client } = makeClient();
    client.connect();
    FakeSocket.all[0].serverOpen();
    expect(client.sendFrame(new ArrayBuffer(4))).toBe(1);
    FakeSocket.all[0].drop();
    vi.advanceTimersByTime(500);
    FakeSocket.all[1].serverOpen();
    expect(client.sendFrame(new ArrayBuffer(4))).toBe(2);
  });
});

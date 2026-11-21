// Binary framing from contracts/protocol.py (docs/CONTRACTS.md §5).
//   client → server: uint32 seq, uint32 t_ms (little-endian) + JPEG
//   server → client: uint8 len(id), id (ASCII) + audio/mpeg

const UINT32_MAX = 0xffffffff;

export function packFrame(seq: number, tMs: number, jpeg: ArrayBuffer): ArrayBuffer {
  if (!Number.isInteger(seq) || !Number.isInteger(tMs) || seq < 0 || tMs < 0 || seq > UINT32_MAX || tMs > UINT32_MAX) {
    throw new RangeError(`seq and t_ms must fit in uint32, got ${seq}, ${tMs}`);
  }
  const out = new Uint8Array(8 + jpeg.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, seq, true);
  view.setUint32(4, tMs, true);
  out.set(new Uint8Array(jpeg), 8);
  return out.buffer;
}

export function unpackAudio(data: ArrayBuffer): { id: string; audio: Uint8Array } {
  const bytes = new Uint8Array(data);
  const n = bytes[0];
  if (bytes.length === 0 || n === 0 || bytes.length < 1 + n) throw new RangeError('audio frame shorter than its id');
  const id = new TextDecoder('ascii').decode(bytes.subarray(1, 1 + n));
  return { id, audio: bytes.subarray(1 + n) };
}

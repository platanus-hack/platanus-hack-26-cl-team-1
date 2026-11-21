import { describe, expect, it } from 'vitest';
import { TimeoutError } from './errors';
import { parseIntelHex } from './intelhex';
import type { ByteIO } from './serial';
import {
  cmdEnterProgmode,
  cmdGetSync,
  cmdLeaveProgmode,
  cmdLoadAddress,
  cmdProgramPage,
  cmdReadPage,
  cmdReadSignature,
  programStk500,
  STK,
} from './stk500';

describe('STK500v1 packets', () => {
  it('builds the fixed commands', () => {
    expect(Array.from(cmdGetSync())).toEqual([0x30, 0x20]);
    expect(Array.from(cmdReadSignature())).toEqual([0x75, 0x20]);
    expect(Array.from(cmdEnterProgmode())).toEqual([0x50, 0x20]);
    expect(Array.from(cmdLeaveProgmode())).toEqual([0x51, 0x20]);
  });

  it('load address uses the WORD address little-endian', () => {
    expect(Array.from(cmdLoadAddress(0))).toEqual([0x55, 0x00, 0x00, 0x20]);
    expect(Array.from(cmdLoadAddress(0x80))).toEqual([0x55, 0x40, 0x00, 0x20]);
    expect(Array.from(cmdLoadAddress(0x7f80))).toEqual([0x55, 0xc0, 0x3f, 0x20]);
  });

  it('program page has a big-endian size, F and the data', () => {
    const data = Uint8Array.from({ length: 128 }, (_, i) => i);
    const p = cmdProgramPage(data);
    expect(p.length).toBe(133);
    expect(Array.from(p.slice(0, 4))).toEqual([0x64, 0x00, 0x80, 0x46]);
    expect(p[4]).toBe(0);
    expect(p[131]).toBe(127);
    expect(p[132]).toBe(0x20);
    expect(Array.from(cmdReadPage(256))).toEqual([0x74, 0x01, 0x00, 0x46, 0x20]);
  });
});

/** Byte-level optiboot emulator implementing ByteIO. */
class FakeOptiboot implements ByteIO {
  flash = new Uint8Array(32768).fill(0xff);
  out: number[] = [];
  addr = 0;
  progmode = false;
  left = false;
  syncFailures: number;
  signature: number[];
  log: number[] = [];

  constructor(opts: { syncFailures?: number; signature?: number[] } = {}) {
    this.syncFailures = opts.syncFailures ?? 0;
    this.signature = opts.signature ?? [0x1e, 0x95, 0x0f];
  }

  async write(p: Uint8Array): Promise<void> {
    const cmd = p[0];
    this.log.push(cmd);
    if (p[p.length - 1] !== STK.CRC_EOP) {
      this.out.push(STK.NOSYNC);
      return;
    }
    const ok = (...payload: number[]) => this.out.push(STK.INSYNC, ...payload, STK.OK);
    switch (cmd) {
      case STK.GET_SYNC:
        if (this.syncFailures > 0) {
          this.syncFailures--;
          return; // silent: still running the old sketch
        }
        ok();
        break;
      case STK.READ_SIGN: ok(...this.signature); break;
      case STK.ENTER_PROGMODE: this.progmode = true; ok(); break;
      case STK.LEAVE_PROGMODE: this.left = true; ok(); break;
      case STK.LOAD_ADDRESS: this.addr = (p[1] | (p[2] << 8)) * 2; ok(); break;
      case STK.PROG_PAGE: {
        const size = (p[1] << 8) | p[2];
        expect(p[3]).toBe(0x46);
        expect(this.progmode).toBe(true);
        this.flash.set(p.subarray(4, 4 + size), this.addr);
        ok();
        break;
      }
      case STK.READ_PAGE: {
        const size = (p[1] << 8) | p[2];
        ok(...this.flash.subarray(this.addr, this.addr + size));
        break;
      }
      default:
        this.out.push(STK.NOSYNC);
    }
  }

  async read(n: number): Promise<Uint8Array> {
    if (this.out.length < n) throw new TimeoutError();
    return Uint8Array.from(this.out.splice(0, n));
  }

  async drain(): Promise<void> {
    this.out = [];
  }
}

function hexOf(bytes: number[]): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.slice(off, off + 16);
    const rec = [chunk.length, (off >> 8) & 0xff, off & 0xff, 0, ...chunk];
    const sum = (0x100 - (rec.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
    lines.push(':' + [...rec, sum].map((b) => b.toString(16).padStart(2, '0')).join(''));
  }
  return lines.join('\n') + '\n:00000001FF\n';
}

describe('programStk500 against a fake optiboot', () => {
  const program = Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
  const image = parseIntelHex(hexOf(program));

  it('syncs (with retries), writes, verifies and leaves progmode', async () => {
    const dev = new FakeOptiboot({ syncFailures: 3 });
    const progress: Array<[number, string]> = [];
    const r = await programStk500(dev, image, { onProgress: (f, m) => progress.push([f, m]) });
    expect(r.signature).toBe('1e950f');
    expect(r.pages).toBe(3); // 300 bytes → 3 × 128-byte pages
    expect(Array.from(dev.flash.slice(0, 300))).toEqual(program);
    expect(dev.flash[300]).toBe(0xff);
    expect(dev.left).toBe(true);
    expect(dev.log.filter((c) => c === STK.PROG_PAGE)).toHaveLength(3);
    expect(dev.log.filter((c) => c === STK.READ_PAGE)).toHaveLength(3);
    const fractions = progress.map(([f]) => f);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(progress.some(([, m]) => m.startsWith('Verificando'))).toBe(true);
  });

  it('fails clearly when the board never answers', async () => {
    const dev = new FakeOptiboot({ syncFailures: 100 });
    await expect(programStk500(dev, image)).rejects.toMatchObject({ code: 'no-sync' });
  });

  it('rejects a board that is not an ATmega328', async () => {
    const dev = new FakeOptiboot({ signature: [0x1e, 0x98, 0x01] });
    await expect(programStk500(dev, image)).rejects.toMatchObject({ code: 'wrong-board' });
  });

  it('detects a verification mismatch', async () => {
    const dev = new FakeOptiboot();
    const realWrite = dev.write.bind(dev);
    dev.write = async (p) => {
      await realWrite(p);
      if (p[0] === STK.PROG_PAGE) dev.flash[dev.addr] ^= 0xff; // corrupt one byte per page
    };
    await expect(programStk500(dev, image)).rejects.toMatchObject({ code: 'failed' });
  });
});

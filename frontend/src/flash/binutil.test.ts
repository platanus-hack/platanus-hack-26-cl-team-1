import { describe, expect, it } from 'vitest';
import type { BoardProfile } from '@/contracts';
import { ESP32_APP_OFFSET, espFlashOffset, looksLikeEspImage, trimTrailingFF } from './binutil';

const esp = {
  toolchain: { core: 'esp32:esp32', minCoreVersion: '3.0.0', libraries: [], artifactSuffix: '.ino.merged.bin' },
  upload: { protocol: 'esptool', baud: 460800, artifact: 'bin', flashOffset: 0, chip: 'ESP32-C6' },
} as unknown as BoardProfile;

describe('espFlashOffset', () => {
  it('merged image at upload.flashOffset, app-only fallback at 0x10000', () => {
    expect(espFlashOffset('sketch.ino.merged.bin', esp)).toBe(0);
    expect(espFlashOffset('sketch.ino.bin', esp)).toBe(ESP32_APP_OFFSET);
    expect(espFlashOffset(undefined, esp)).toBe(0);
  });
});

describe('trimTrailingFF', () => {
  it('drops 0xFF padding and rounds up to the sector size', () => {
    const data = new Uint8Array(4 * 4096).fill(0xff);
    data.set([0xe9, 1, 2], 0);
    data[5000] = 7;
    const t = trimTrailingFF(data);
    expect(t.length).toBe(8192);
    expect(t[5000]).toBe(7);
  });

  it('keeps already-aligned data and never grows', () => {
    const data = new Uint8Array(100).fill(1);
    expect(trimTrailingFF(data).length).toBe(100);
    expect(trimTrailingFF(new Uint8Array(10000).fill(0xff)).length).toBe(4096);
  });

  it('recognises the ESP image magic', () => {
    expect(looksLikeEspImage(Uint8Array.from([0xe9, 0]))).toBe(true);
    expect(looksLikeEspImage(Uint8Array.from([0x3a]))).toBe(false);
  });
});

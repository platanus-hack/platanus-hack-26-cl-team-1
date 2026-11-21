import { describe, expect, it } from 'vitest';
import { packFrame, unpackAudio } from './frames';

describe('packFrame', () => {
  it('writes seq and t_ms little-endian before the JPEG', () => {
    const jpeg = new Uint8Array([0xff, 0xd8]).buffer;
    const bytes = new Uint8Array(packFrame(7, 1234, jpeg));
    expect(Array.from(bytes)).toEqual([7, 0, 0, 0, 0xd2, 0x04, 0, 0, 0xff, 0xd8]);
  });

  it('rejects values outside uint32', () => {
    expect(() => packFrame(-1, 0, new ArrayBuffer(1))).toThrow(RangeError);
    expect(() => packFrame(0, 2 ** 32, new ArrayBuffer(1))).toThrow(RangeError);
  });
});

describe('unpackAudio', () => {
  it('splits the id from the audio', () => {
    const frame = new Uint8Array([3, 0x63, 0x31, 0x32, 9, 8]).buffer; // "c12" + audio
    const { id, audio } = unpackAudio(frame);
    expect(id).toBe('c12');
    expect(Array.from(audio)).toEqual([9, 8]);
  });

  it('rejects a frame shorter than its id', () => {
    expect(() => unpackAudio(new Uint8Array([5, 0x61]).buffer)).toThrow(RangeError);
  });
});

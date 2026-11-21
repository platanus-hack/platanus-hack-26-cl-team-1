import { describe, expect, it } from 'vitest';
import { frameSize } from './capture';

describe('frameSize', () => {
  it('scales a 16:9 landscape camera to 640 wide', () => {
    expect(frameSize(1920, 1080)).toEqual({ width: 640, height: 360 });
  });

  it('scales a portrait camera to 640 tall', () => {
    expect(frameSize(1080, 1920)).toEqual({ width: 360, height: 640 });
  });

  it('keeps a 640x480 camera as is', () => {
    expect(frameSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('never upscales a small camera', () => {
    expect(frameSize(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it('rounds to whole pixels', () => {
    expect(frameSize(1280, 721)).toEqual({ width: 640, height: 361 });
  });

  it('rejects a video with no size yet', () => {
    expect(() => frameSize(0, 480)).toThrow(RangeError);
  });
});

import { describe, expect, it } from 'vitest';
import { loadCameraId, pickCamera } from './camera';

const devs = [
  { deviceId: 'a', label: 'FaceTime' },
  { deviceId: 'b', label: 'Cámara del iPhone' },
];

describe('pickCamera', () => {
  it('uses the saved camera when it is connected', () => {
    expect(pickCamera(devs, 'b')).toEqual({ deviceId: 'b', missing: false });
  });

  it('falls back to the first camera and flags it when the saved one is gone', () => {
    expect(pickCamera(devs, 'gone')).toEqual({ deviceId: 'a', missing: true });
  });

  it('uses the first camera when nothing was saved', () => {
    expect(pickCamera(devs, null)).toEqual({ deviceId: 'a', missing: false });
  });

  it('returns no camera when none is connected', () => {
    expect(pickCamera([], 'b')).toEqual({ deviceId: null, missing: true });
  });
});

describe('loadCameraId', () => {
  it('returns null when storage is unavailable', () => {
    expect(loadCameraId()).toBeNull();
  });
});

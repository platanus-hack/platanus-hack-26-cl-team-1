import { describe, expect, it } from 'vitest';
import { cameraForReconnect, cameraToOpen, loadCameraId, pickCamera } from './camera';

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

describe('cameraToOpen', () => {
  const withPhone = [
    { deviceId: 'facetime', label: 'FaceTime' },
    { deviceId: 'iphone', label: 'Cámara del iPhone' },
  ];
  const withoutPhone = [{ deviceId: 'facetime', label: 'FaceTime' }];

  it('goes back to the chosen camera when it reconnects after a fallback', () => {
    expect(cameraToOpen(withoutPhone, 'iphone', null)).toEqual({ deviceId: 'facetime', missing: true });
    expect(cameraToOpen(withPhone, 'iphone', null)).toEqual({ deviceId: 'iphone', missing: false });
  });

  it('uses the saved camera when nothing was chosen in this page', () => {
    expect(cameraToOpen(withPhone, null, 'iphone')).toEqual({ deviceId: 'iphone', missing: false });
  });

  it('ignores empty ids (devices listed before camera permission)', () => {
    expect(cameraToOpen(withoutPhone, '', '')).toEqual({ deviceId: 'facetime', missing: false });
  });
});

describe('cameraForReconnect', () => {
  const withPhone = [
    { deviceId: 'facetime', label: 'FaceTime' },
    { deviceId: 'iphone', label: 'Cámara del iPhone' },
  ];
  const withoutPhone = [{ deviceId: 'facetime', label: 'FaceTime' }];

  it('reconnects to the camera the session was using', () => {
    expect(cameraForReconnect(withPhone, 'iphone')).toBe('iphone');
  });

  it('refuses to fall back when that camera is not connected', () => {
    expect(cameraForReconnect(withoutPhone, 'iphone')).toBeNull();
  });
});

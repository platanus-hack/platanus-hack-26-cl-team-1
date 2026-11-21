// Which camera to open (owner: Anaís). The choice (the iPhone via Continuity Camera, on the demo Mac)
// is remembered per browser; storage may be unavailable, and the page works without it.
import type { Camera } from './capture';

const KEY = 'supervisor.cameraId';

/** The saved camera if it's connected, else the first one; `missing` says the saved one wasn't found. */
export function pickCamera(devices: Camera[], saved: string | null): { deviceId: string | null; missing: boolean } {
  if (saved && devices.some((d) => d.deviceId === saved)) return { deviceId: saved, missing: false };
  return { deviceId: devices[0]?.deviceId ?? null, missing: saved !== null || devices.length === 0 };
}

export function loadCameraId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveCameraId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

/**
 * The camera to open after a device-list change: the one chosen on this page, else the saved one, so a
 * camera that drops and comes back (Continuity Camera) wins again over the fallback used meanwhile.
 */
export function cameraToOpen(
  devices: Camera[],
  chosen: string | null,
  saved: string | null,
): { deviceId: string | null; missing: boolean } {
  return pickCamera(devices, chosen || saved || null);
}

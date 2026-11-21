/** Webcam access: device list + a 640×480 stream on the chosen device. */
import { useCallback, useEffect, useRef, useState } from 'react';

const DEVICE_KEY = 'cv.cameraId';

export const FRAME_W = 640;
export const FRAME_H = 480;

export interface CameraState {
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  deviceId: string;
  error: string | null;
  start: (deviceId?: string) => Promise<MediaStream | null>;
  stop: () => void;
  setDeviceId: (id: string) => void;
}

function errorText(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'El navegador no dio permiso para usar la cámara.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No encontré una cámara disponible.';
  if (name === 'NotReadableError') return 'La cámara está ocupada por otra aplicación.';
  if (!window.isSecureContext) return 'La cámara solo funciona con HTTPS (o en localhost).';
  return 'No pude abrir la cámara.';
}

export function useCamera(): CameraState {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(DEVICE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === 'videoinput'));
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(
    async (id?: string) => {
      stop();
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(errorText(null));
        return null;
      }
      const want = id ?? deviceId;
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: FRAME_W },
            height: { ideal: FRAME_H },
            aspectRatio: { ideal: FRAME_W / FRAME_H },
            frameRate: { ideal: 15 },
            ...(want ? { deviceId: { exact: want } } : {}),
          },
        });
        streamRef.current = s;
        setStream(s);
        await refreshDevices();
        return s;
      } catch (err) {
        setError(errorText(err));
        return null;
      }
    },
    [deviceId, refreshDevices, stop],
  );

  const setDeviceId = useCallback(
    (id: string) => {
      setDeviceIdState(id);
      try {
        localStorage.setItem(DEVICE_KEY, id);
      } catch {
        /* ignore */
      }
      if (streamRef.current) void start(id);
    },
    [start],
  );

  useEffect(() => {
    void refreshDevices();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [refreshDevices]);

  return { stream, devices, deviceId, error, start, stop, setDeviceId };
}

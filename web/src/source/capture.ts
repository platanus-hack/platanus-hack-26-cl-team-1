// Frame source (owner: Anaís): a camera played in a <video>, captured to JPEG on a canvas. Frames keep the camera's aspect ratio (the iPhone
// is 16:9), long side at most 640 px, never upscaled.

import { FrameGate } from './frameGate';

const MAX_SIDE = 640;

export type Camera = { deviceId: string; label: string };

export function frameSize(videoWidth: number, videoHeight: number, maxSide = MAX_SIDE): { width: number; height: number } {
  if (!(videoWidth > 0) || !(videoHeight > 0)) {
    throw new RangeError(`video size must be positive, got ${videoWidth}x${videoHeight}`);
  }
  const scale = Math.min(1, maxSide / Math.max(videoWidth, videoHeight));
  return { width: Math.round(videoWidth * scale), height: Math.round(videoHeight * scale) };
}

/** Video inputs. Labels are empty until the page has camera permission. */
export async function listCameras(): Promise<Camera[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** Opens a camera (the default one when `deviceId` is null); `onEnded` fires once if it disconnects. */
export async function openWebcam(
  video: HTMLVideoElement,
  deviceId: string | null,
  onEnded: () => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  let ended = false;
  let closed = false;
  const onTrackEnded = () => {
    if (ended || closed) return;
    ended = true;
    onEnded();
  };
  stream.getVideoTracks().forEach((t) => t.addEventListener('ended', onTrackEnded));
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop()); // don't leave the camera on when playback fails
    if (video.srcObject === stream) video.srcObject = null;
    throw error;
  }
  return () => {
    closed = true;
    stream.getTracks().forEach((t) => t.stop());
    if (video.srcObject === stream) video.srcObject = null; // a newer session may own the video now
  };
}

/**
 * Grab JPEG frames from `video` at `fps`; returns a stop function. Only frames the camera actually
 * presented are sent (a frozen camera isn't resent as if live); no new frame for `stallMs` stops the
 * capture and calls `onStall` once. Skips a tick while one is encoding.
 */
export function startCapture(
  video: HTMLVideoElement,
  fps: number,
  onJpeg: (jpeg: ArrayBuffer) => void,
  onStall: () => void,
  stallMs = 3000,
): () => void {
  if (!('requestVideoFrameCallback' in video)) {
    throw new Error('este navegador no avisa cuándo llega cada cuadro de la cámara; usa Chrome');
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const gate = new FrameGate(stallMs, performance.now());
  let stopped = false;
  let frameHandle = 0;
  const onFrame = () => {
    if (stopped) return;
    gate.markFrame(performance.now());
    frameHandle = video.requestVideoFrameCallback(onFrame);
  };
  frameHandle = video.requestVideoFrameCallback(onFrame);
  let encoding = false;
  const stop = () => {
    stopped = true;
    window.clearInterval(timer);
    video.cancelVideoFrameCallback(frameHandle);
  };
  const timer = window.setInterval(() => {
    if (encoding) return;
    if (document.visibilityState === 'hidden') {
      gate.hold(performance.now()); // Chrome pauses frame callbacks in a hidden tab; not a frozen camera
      return;
    }
    const verdict = gate.take(performance.now());
    if (verdict === 'stalled') {
      stop();
      onStall();
      return;
    }
    if (verdict === 'skip' || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const { width, height } = frameSize(video.videoWidth, video.videoHeight);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    encoding = true;
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        encoding = false;
        if (blob) void blob.arrayBuffer().then(onJpeg);
      },
      'image/jpeg',
      0.7,
    );
  }, 1000 / fps);
  return stop;
}

/**
 * Grab JPEG frames from an in-page simulator's canvas at `fps` (long side at most 640 px, like the camera);
 * returns a stop function. A canvas has no "new frame" signal, so every tick is sent: the simulator
 * redraws continuously while it runs. Skips a tick while one is encoding, and while the tab is hidden
 * (the simulator's render loop pauses there too).
 */
export function startCanvasCapture(source: HTMLCanvasElement, fps: number, onJpeg: (jpeg: ArrayBuffer) => void): () => void {
  const canvas = document.createElement('canvas');
  const { width, height } = frameSize(source.width, source.height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  let encoding = false;
  const timer = window.setInterval(() => {
    if (encoding || document.visibilityState === 'hidden') return;
    encoding = true;
    ctx.drawImage(source, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        encoding = false;
        if (blob) void blob.arrayBuffer().then(onJpeg);
      },
      'image/jpeg',
      0.7,
    );
  }, 1000 / fps);
  return () => window.clearInterval(timer);
}

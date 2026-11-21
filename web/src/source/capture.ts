// Frame source (owner: Anaís): a camera played in a <video>, captured to JPEG on a canvas. Frames keep the camera's aspect ratio (the iPhone
// is 16:9), long side at most 640 px, never upscaled.

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
  await video.play();
  return () => {
    closed = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

/** Grab JPEG frames from `video` at `fps`; returns a stop function. Skips a tick while one is encoding. */
export function startCapture(video: HTMLVideoElement, fps: number, onJpeg: (jpeg: ArrayBuffer) => void): () => void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  let encoding = false;
  const timer = window.setInterval(() => {
    if (encoding || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
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
  return () => window.clearInterval(timer);
}

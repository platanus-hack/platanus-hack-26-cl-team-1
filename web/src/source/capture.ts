// Frame source (owner: Anaís): the webcam or a simulated clip, both played in a <video>, are captured
// the same way, so the server can't tell them apart.

export async function openWebcam(video: HTMLVideoElement): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
  video.srcObject = stream;
  await video.play();
  return () => stream.getTracks().forEach((t) => t.stop());
}

export async function openClip(video: HTMLVideoElement, file: File): Promise<() => void> {
  const url = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = url;
  video.loop = true;
  video.muted = true;
  await video.play();
  return () => {
    video.pause();
    URL.revokeObjectURL(url);
  };
}

/** Grab JPEG frames from `video` at `fps`; returns a stop function. Skips a tick while one is encoding. */
export function startCapture(video: HTMLVideoElement, fps: number, onJpeg: (jpeg: ArrayBuffer) => void): () => void {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  let encoding = false;
  const timer = window.setInterval(() => {
    if (encoding || video.readyState < 2) return;
    encoding = true;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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

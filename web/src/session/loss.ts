// Why a live session stopped, worded for the red banner (owner: Anaís). The server sends `error` and
// then closes the socket, so its message is the real reason, not the close code.

export type Loss =
  | { kind: 'camera' }
  | { kind: 'camera_stalled' }
  | { kind: 'closed'; reason: string; serverError: string | null }
  | { kind: 'start'; error: string };

export function describeLoss(loss: Loss): string {
  switch (loss.kind) {
    case 'camera':
      return 'Se desconectó la cámara.';
    case 'camera_stalled':
      return 'La cámara dejó de enviar imagen.';
    case 'closed':
      return loss.serverError
        ? `El servidor cerró la sesión: ${loss.serverError}`
        : `Se cortó la conexión: ${loss.reason}`;
    case 'start':
      return `No pude empezar: ${loss.error}`;
  }
}

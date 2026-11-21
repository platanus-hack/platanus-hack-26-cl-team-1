/** Flashing errors with a Spanish message for the student and an optional hint (what to try). */

export type FlashErrorCode =
  | 'unsupported' // no Web Serial (Firefox/Safari)
  | 'cancelled' // the user closed the port picker
  | 'busy' // the port could not be opened
  | 'no-sync' // the bootloader did not answer
  | 'wrong-board' // signature / chip does not match
  | 'artifact' // missing or corrupt binary
  | 'lost' // device disconnected mid-flash
  | 'failed';

export class FlashError extends Error {
  readonly code: FlashErrorCode;
  readonly hint?: string;
  constructor(code: FlashErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'FlashError';
    this.code = code;
    this.hint = hint;
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Tiempo de espera agotado') {
    super(message);
    this.name = 'TimeoutError';
  }
}

const HINT_BUSY =
  'Cierra el Monitor Serie del IDE de Arduino, otras pestañas que usen la placa u otros programas, y vuelve a intentarlo.';

/** Normalize anything thrown while talking to a port into a FlashError. */
export function toFlashError(err: unknown, fallbackHint?: string): FlashError {
  if (err instanceof FlashError) return err;
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'NotFoundError' || /No port selected/i.test(msg)) {
    return new FlashError('cancelled', 'No se eligió ningún puerto USB.');
  }
  if (name === 'SecurityError') {
    return new FlashError('unsupported', 'El navegador bloqueó el acceso al puerto USB.', 'Abre la app directamente (no dentro de un iframe) en Chrome o Edge.');
  }
  if (name === 'InvalidStateError' || (name === 'NetworkError' && /open/i.test(msg)) || /Failed to open/i.test(msg)) {
    return new FlashError('busy', 'No se pudo abrir el puerto: está ocupado por otro programa.', HINT_BUSY);
  }
  if (name === 'NetworkError' || /device has been lost|disconnected/i.test(msg)) {
    return new FlashError('lost', 'Se perdió la conexión con la placa durante la carga.', 'Revisa el cable USB (que no esté suelto) y vuelve a intentarlo.');
  }
  return new FlashError('failed', `La carga falló: ${msg}`, fallbackHint);
}

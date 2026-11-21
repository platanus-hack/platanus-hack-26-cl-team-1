import { describe, expect, it } from 'vitest';
import { describeLoss } from './loss';

describe('describeLoss', () => {
  it('names the camera, not the connection, when the camera drops', () => {
    expect(describeLoss({ kind: 'camera' })).toBe('Se desconectó la cámara.');
  });

  it('names a stalled camera', () => {
    expect(describeLoss({ kind: 'camera_stalled' })).toBe('La cámara dejó de enviar imagen.');
  });

  it("shows the server's error instead of the close code", () => {
    expect(describeLoss({ kind: 'closed', reason: 'closed (1000)', serverError: "no task 'x'" })).toBe(
      "El servidor cerró la sesión: no task 'x'",
    );
  });

  it('shows the close reason when the server sent no error', () => {
    expect(describeLoss({ kind: 'closed', reason: 'closed (1012)', serverError: null })).toBe(
      'Se cortó la conexión: closed (1012)',
    );
  });

  it('says the start failed', () => {
    expect(describeLoss({ kind: 'start', error: 'NotAllowedError: Permission denied' })).toBe(
      'No pude empezar: NotAllowedError: Permission denied',
    );
  });
});

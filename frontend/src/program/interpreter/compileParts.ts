/** Part-level actions (LED, RGB, buzzer, servo, motor) resolved through Bindings. */
import { percentToPwm, resolvePart, RGB_CHANNELS, toNum, toPwm, toServoAngle, truthy } from '../codegen/shared';
import type { PartStmt } from '../codegen/walk';
import { compileExpr, type Ev } from './compileExpr';
import { digitalOut, noop, type CStmt, type StmtEnv } from './env';

export function compilePartAction(env: StmtEnv, s: PartStmt): CStmt {
  const { rt, ctx } = env;
  const ex = (e: Parameters<typeof compileExpr>[1]) => compileExpr(env, e);
  if (s.k === 'rgb') {
    const chans = RGB_CHANNELS.map((ch) => ({ r: resolvePart(ctx, rt.board, s.part, ch), v: ex(s[ch]) })).filter(
      (c): c is { r: NonNullable<typeof c.r>; v: Ev } => !!c.r,
    );
    return {
      sync: () => {
        for (const c of chans) {
          const v = toPwm(toNum(c.v()));
          rt.writePwm(c.r.boardPin, c.r.binding.activeLow ? 255 - v : v);
        }
      },
    };
  }
  const r = resolvePart(ctx, rt.board, s.part);
  if (!r) return noop();
  const pin = r.boardPin;
  const low = r.binding.activeLow;
  switch (s.k) {
    case 'led': {
      const on = ex(s.on);
      return { sync: () => digitalOut(env, pin, truthy(on()) !== low) };
    }
    case 'ledBrightness':
    case 'motor': {
      const p = ex(s.k === 'motor' ? s.speed : s.percent);
      return {
        sync: () => {
          const v = percentToPwm(toNum(p()));
          rt.writePwm(pin, low ? 255 - v : v);
        },
      };
    }
    case 'buzzerTone': {
      const f = ex(s.freq);
      const ms = s.ms ? ex(s.ms) : null;
      return { sync: () => rt.startTone(pin, toNum(f()), ms ? toNum(ms()) : undefined) };
    }
    case 'buzzerOff':
      return { sync: () => rt.stopTone(pin) };
    case 'servo': {
      if (!env.servos.has(s.part)) return noop();
      const a = ex(s.angle);
      const part = s.part;
      return { sync: () => rt.host.servoWrite(part, toServoAngle(toNum(a()))) };
    }
    default:
      return noop();
  }
}

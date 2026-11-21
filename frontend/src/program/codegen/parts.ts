/** Codegen for part-level actions (LED, RGB, buzzer, servo, motor) and the onboard LED. */
import type { Stmt } from '@/contracts';
import { constrainExpr, emitExpr, numLit, numLitValue, type CExpr } from './expr';
import { digitalOut, level, line, percentPwm, pwmValue, pwmWarning, toneCode } from './emit-utils';
import { partLabel, resolvePart, RGB_CHANNELS, toServoAngle, truthy } from './shared';
import { constKey, unboundPart, warn, type GenState } from './state';
import { hasSideEffects, type PartStmt } from './walk';

export function emitOnboardLed(g: GenState, onExpr: Extract<Stmt, { k: 'onboardLed' }>['on'], id: string | undefined): void {
  const on = emitExpr(g, onExpr);
  const led = g.board?.onboard.find((o) => o.kind === 'led');
  const rgb = g.board?.onboard.find((o) => o.kind === 'rgb-ws2812');
  if (led) {
    const lv = level(on);
    line(g, `digitalWrite(LED_BUILTIN, ${lv.code});`, id, lv.on === undefined ? 'LED integrado' : `${lv.on ? 'enciende' : 'apaga'} el LED integrado`);
  } else if (rgb) {
    if (on.lit !== undefined) {
      const v = truthy(on.lit) ? 255 : 0;
      line(g, `rgbLedWrite(RGB_BUILTIN, ${v}, ${v}, ${v});`, id, `LED integrado ${v ? 'en blanco' : 'apagado'}`);
    } else {
      line(g, `if (${on.code}) rgbLedWrite(RGB_BUILTIN, 255, 255, 255);`, id, 'LED integrado en blanco');
      g.out.line('else rgbLedWrite(RGB_BUILTIN, 0, 0, 0);', id, 'o apagado');
    }
  } else {
    warn(g, 'Esta placa no tiene un LED integrado: el bloque se omitió.', { blockId: id });
    line(g, '// ⚠ Esta placa no tiene LED integrado', id);
  }
}

export function emitPartAction(g: GenState, s: PartStmt, id: string | undefined): void {
  const label = partLabel(g.ctx, s.part);
  if (s.k === 'rgb') {
    const exprs = { r: emitExpr(g, s.r), g: emitExpr(g, s.g), b: emitExpr(g, s.b) };
    for (const ch of RGB_CHANNELS) {
      const r = resolvePart(g.ctx, g.board, s.part, ch);
      if (!r) {
        line(g, unboundPart(g, s.part, id, ch), id);
        continue;
      }
      pwmWarning(g, r, `El canal ${ch.toUpperCase()} de «${label}»`, id, s.part);
      const pin = g.partConsts.get(constKey(s.part, ch)) ?? r.codeName;
      const pv = pwmValue(g, exprs[ch]);
      const val = r.binding.activeLow ? (pv.lit !== undefined ? String(255 - pv.lit) : `255 - ${pv.code}`) : pv.code;
      line(g, `analogWrite(${pin}, ${val});`, id, `${label}: ${{ r: 'rojo', g: 'verde', b: 'azul' }[ch]}`);
    }
    return;
  }

  // Evaluate arguments first so unbound-sensor comments are flushed in order.
  const args = partArgs(g, s);
  const r = resolvePart(g.ctx, g.board, s.part);
  if (!r) {
    line(g, unboundPart(g, s.part, id), id);
    return;
  }
  const pin = s.k === 'servo' ? '' : (g.partConsts.get(constKey(s.part)) ?? r.codeName);
  const low = r.binding.activeLow;
  switch (s.k) {
    case 'led': {
      const on = args[0].lit === undefined ? undefined : truthy(args[0].lit);
      const comment = on === undefined ? `${label}${low ? ' (se enciende con LOW)' : ''}` : `${on ? 'enciende' : 'apaga'} ${label}`;
      digitalOut(g, pin, r.boardPin, args[0], low, id, comment);
      return;
    }
    case 'ledBrightness':
    case 'motor': {
      pwmWarning(g, r, `«${label}»`, id, s.part);
      const p = numLitValue(args[0]);
      const what = s.k === 'motor' ? 'velocidad' : 'brillo';
      const comment = p !== undefined ? `${what} de ${label}: ${Math.max(0, Math.min(100, p))} %` : `${what} de ${label}`;
      line(g, `analogWrite(${pin}, ${percentPwm(g, args[0], low)});`, id, comment);
      return;
    }
    case 'buzzerTone': {
      const f = args[0];
      const ms = args[1] ?? null;
      const fl = numLitValue(f);
      const t = toneCode(g, pin, f, ms);
      const comment = t.silent ? `silencia ${label} (frecuencia menor que 1 Hz)` : fl !== undefined ? `${label} suena a ${fl} Hz` : `${label} suena`;
      line(g, t.code, id, comment);
      return;
    }
    case 'buzzerOff':
      line(g, `noTone(${pin});`, id, `silencia ${label}`);
      return;
    case 'servo': {
      const obj = g.servoObjects.get(s.part);
      if (!obj) {
        line(g, unboundPart(g, s.part, id), id);
        return;
      }
      const a = numLitValue(args[0]);
      const val = a !== undefined ? String(toServoAngle(a)) : constrainExpr(g, [args[0], numLit(0), numLit(180)], hasSideEffects(s.angle)).code;
      line(g, `${obj}.write(${val});`, id, `mueve ${label}${a !== undefined ? ` a ${toServoAngle(a)}°` : ''}`);
      return;
    }
  }
}

function partArgs(g: GenState, s: PartStmt): CExpr[] {
  switch (s.k) {
    case 'led':
      return [emitExpr(g, s.on)];
    case 'ledBrightness':
      return [emitExpr(g, s.percent)];
    case 'motor':
      return [emitExpr(g, s.speed)];
    case 'servo':
      return [emitExpr(g, s.angle)];
    case 'buzzerTone':
      return s.ms ? [emitExpr(g, s.freq), emitExpr(g, s.ms)] : [emitExpr(g, s.freq)];
    default:
      return [];
  }
}


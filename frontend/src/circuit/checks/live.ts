/** Checks that need the live solve (CircuitResult). */
import { formatCurrent } from '@/lib/format';
import { fmtmA, label, netIdFor, type CheckContext } from './issues';
import { overvoltageIssue } from './drivers';
import { partsOnNet } from './structure';

export function liveChecks(ctx: CheckContext): void {
  const { result } = ctx;
  if (!result) return;
  shortChecks(ctx);
  burnedChecks(ctx);
  pinChecks(ctx);
  supplyChecks(ctx);
}

function shortChecks(ctx: CheckContext): void {
  for (const s of ctx.result?.shorts ?? []) {
    ctx.issues.add({
      code: 'short-circuit',
      severity: 'error',
      title: '¡Cortocircuito!',
      message: s.message,
      fix: 'Revisa qué une el + con el − sin un componente en medio (un cable, un botón presionado, una pata en la fila equivocada) y quítalo.',
      parts: s.parts,
      nets: s.nets,
    });
  }
}

function burnedChecks(ctx: CheckContext): void {
  const { topo, result } = ctx;
  for (const rec of topo.parts) {
    if (!result?.parts[rec.part.id]?.burned) continue;
    const el = rec.def.electrical;
    const isLed = el.model === 'led' || el.model === 'rgb-led';
    const limit = el.model === 'led' || el.model === 'rgb-led' || el.model === 'diode' || el.model === 'npn' ? ` (máximo ${el.maxmA} mA)` : '';
    ctx.issues.add({
      code: 'part-burned',
      severity: 'error',
      title: `${label(rec)} se quemó`,
      message: `Por ${label(rec)} pasó más corriente de la que aguanta${limit} y se dañó: ahora está abierto y no deja pasar corriente.${
        isLed ? ' Un LED siempre necesita una resistencia en serie que limite la corriente.' : ''
      }`,
      fix: isLed
        ? 'Agrega una resistencia de 220 Ω a 1 kΩ en serie y luego usa «Reparar» para cambiar el componente.'
        : 'Corrige la causa (falta una resistencia o hay un cortocircuito) y luego usa «Reparar».',
      parts: [rec.part.id],
    });
  }
}

function pinChecks(ctx: CheckContext): void {
  const { an, result } = ctx;
  const board = an.board;
  if (!board || !result) return;
  const { profile } = board;
  const rec = profile.pinCurrent.recommendedmA / 1000;
  const max = profile.pinCurrent.maxmA / 1000;
  for (const bp of profile.pins) {
    if (bp.kind !== 'gpio' || bp.aliasOf) continue;
    const st = result.boardPins[bp.id];
    if (!st) continue;
    const net = an.net(board.rec.part.id, bp.id);
    const amps = Math.abs(st.currentA);
    if (amps > rec) {
      const error = amps > max;
      ctx.issues.add({
        code: 'pin-overcurrent',
        severity: error ? 'error' : 'warning',
        title: `${bp.id} entrega demasiada corriente`,
        message: `Por el pin ${bp.id} pasan ${fmtmA(amps)}. Un pin de ${profile.name} da cómodamente ${profile.pinCurrent.recommendedmA} mA y como máximo ${profile.pinCurrent.maxmA} mA; ${
          error ? 'por encima de eso el pin se daña.' : 'así se calienta y se acorta su vida.'
        }`,
        fix: 'Agrega o aumenta la resistencia en serie (220 Ω o más para un LED), o usa un transistor para cargas grandes como motores.',
        parts: [board.rec.part.id, ...partsOnNet(ctx, net)],
        nets: net >= 0 ? [netIdFor(ctx, net)] : undefined,
        idSuffix: bp.id,
      });
    }
    if (st.volts > profile.logicVoltage + 0.3 || st.volts < -0.3) overvoltageIssue(ctx, bp.id, st.volts);
  }
}

function supplyChecks(ctx: CheckContext): void {
  const { result } = ctx;
  if (!result) return;
  for (const s of result.supplies) {
    if (!s.overloaded) continue;
    // Explained by a short touching this supply's + net: its own, series-opposed batteries, a battery
    // reversed into the 5V pin… (an unrelated overload of another rail of the same board still shows).
    const plus = supplyPlusNet(ctx, s);
    if (result.shorts.some((sh) => (plus !== null ? sh.nets.includes(plus) : sh.parts[0] === s.part))) continue;
    const usb = s.id.endsWith(':5V');
    if (s.currentA < 0) {
      backFeedIssue(ctx, s, usb);
      continue;
    }
    ctx.issues.add({
      code: 'supply-overload',
      severity: 'error',
      title: `Sobrecarga en ${s.label}`, // neutral: 'Pilas 4xAA 1' is plural
      message: `Le estás pidiendo ${formatCurrent(s.currentA)} a ${s.label}, pero puede entregar como máximo ${formatCurrent(s.limitA ?? 0)}.${
        usb ? ' El puerto USB del computador tiene un fusible: si se pasa, corta la energía y la placa se reinicia.' : ' La fuente se calienta y su voltaje cae, así que todo funciona mal.'
      }`,
      fix: usb
        ? 'Alimenta los motores y cargas grandes con una batería aparte (uniendo su − con GND), y revisa que cada LED tenga su resistencia.'
        : 'Reduce la carga: agrega resistencias o usa una fuente más potente.',
      parts: [s.part],
      idSuffix: s.id.includes(':') ? s.id.split(':')[1] : undefined,
    });
  }
}

type Supply = NonNullable<CheckContext['result']>['supplies'][number];

/** NetId of a supply's + terminal ('uno1:5V' → the 5V pin, 'bat1' → its plus lead). */
function supplyPlusNet(ctx: CheckContext, s: Supply): string | null {
  const pin = s.id.includes(':') ? s.id.slice(s.id.indexOf(':') + 1) : 'plus';
  const net = ctx.an.net(s.part, pin);
  return net >= 0 ? netIdFor(ctx, net) : null;
}

/** A supply receiving current backwards (a battery on the 5V/3V3 pin, 5V tied to 3V3, two batteries in parallel…). */
function backFeedIssue(ctx: CheckContext, s: Supply, usb: boolean): void {
  const result = ctx.result;
  if (!result) return;
  // Name the source only when it really carries the reverse current (a GPIO driven HIGH is not a supply).
  const pusher = result.supplies.filter((o) => o !== s && o.currentA > -0.5 * s.currentA).sort((a, b) => b.currentA - a.currentA)[0];
  const who = pusher ? (pusher.part === s.part ? `el pin ${pusher.label}` : pusher.label) : null;
  const amps = formatCurrent(-s.currentA);
  const rail = s.id.includes(':');
  ctx.issues.add({
    code: 'supply-overload',
    severity: 'error',
    title: `Corriente al revés en ${rail ? `el pin ${s.label}` : s.label}`,
    message: rail
      ? `Entran ${amps} al revés por el pin ${s.label}. La causa: una fuente de más voltaje${who ? ` (${who})` : ''} está unida directo a esa salida y empuja corriente hacia dentro de la placa. Dos fuentes de distinto voltaje unidas sin nada en medio «pelean»: circula mucha corriente y se puede dañar el regulador de la placa${usb ? ' o el puerto USB del computador' : ''}.`
      : `Por ${s.label} entran ${amps} al revés: una fuente de más voltaje${who ? ` (${who})` : ''} está unida en paralelo y empuja la corriente hacia dentro. Las pilas comunes no son recargables: se calientan y pueden derramar líquido o reventar.`,
    fix: rail
      ? 'No conectes una batería ni otra fuente directo a los pines 5V o 3V3 (ni 5V con 3V3): la placa ya se alimenta por el USB. Si usas una batería para un motor, une solo su − con GND.'
      : 'No conectes en paralelo fuentes de distinto voltaje: cada fuente alimenta su parte del circuito y solo se unen los − (GND).',
    parts: pusher && pusher.part !== s.part ? [s.part, pusher.part] : [s.part],
    idSuffix: rail ? s.id.split(':')[1] : undefined,
  });
}

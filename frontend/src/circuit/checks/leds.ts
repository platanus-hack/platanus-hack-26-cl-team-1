/** LED checks: missing series resistor, reversed, overload (static topology + live result). */
import { isGroundNet, isSourceNet } from '../analysis';
import { sideOf } from '../bindings';
import type { PartRec } from '../topology';
import { fmtmA, label, netIdFor, type CheckContext } from './issues';
import { describeNet, firstNet, reachUnlimited } from './reach';

interface Channel {
  anode: string;
  cathode: string;
  name?: string;
}

function channels(rec: PartRec): Channel[] {
  const el = rec.def.electrical;
  if (el.model === 'led') return [{ anode: 'anode', cathode: 'cathode' }];
  if (el.model === 'rgb-led')
    return [
      { anode: 'r', cathode: 'com', name: 'rojo' },
      { anode: 'g', cathode: 'com', name: 'verde' },
      { anode: 'b', cathode: 'com', name: 'azul' },
    ];
  return [];
}

export function ledChecks(ctx: CheckContext): void {
  const { an, topo, result } = ctx;
  for (const rec of topo.parts) {
    const el = rec.def.electrical;
    if (el.model !== 'led' && el.model !== 'rgb-led') continue;
    const id = rec.part.id;
    const name = label(rec);
    const live = result?.parts[id];
    if (live?.burned) continue; // part-burned explains it

    // --- no resistor (static) ---
    const noRes: Array<{ ch: Channel; src: string; gnd: string; gpio: boolean; nets: number[] }> = [];
    for (const ch of channels(rec)) {
      const na = an.net(id, ch.anode);
      const nc = an.net(id, ch.cathode);
      if (na < 0 || nc < 0 || na === nc) continue;
      const ra = reachUnlimited(an, na, id);
      const rc = reachUnlimited(an, nc, id);
      const bad = (ra.source && (rc.ground || rc.gpio)) || (ra.gpio && rc.ground);
      if (!bad) continue;
      const srcNet = firstNet(ra, isSourceNet) ?? firstNet(ra, (n) => n.gpios.length > 0);
      const gndNet = firstNet(rc, isGroundNet) ?? firstNet(rc, (n) => n.gpios.length > 0);
      noRes.push({
        ch,
        src: describeNet(srcNet, 'source'),
        gnd: describeNet(gndNet, 'ground'),
        gpio: !!(srcNet?.gpios.length || gndNet?.gpios.length),
        nets: [na, nc],
      });
    }
    const overloaded = !!live?.overloaded;
    if (noRes.length) {
      const first = noRes[0];
      const chText = el.model === 'rgb-led' ? ` (canal ${noRes.map((n) => n.ch.name).join(', ')})` : '';
      const now = overloaded && live ? ` Ahora mismo pasan ${fmtmA(live.currentA)} y el máximo son ${el.maxmA} mA.` : '';
      ctx.issues.add({
        code: 'led-no-resistor',
        severity: overloaded ? 'error' : 'warning',
        title: `${name} sin resistencia`,
        message: `${name}${chText} va directo entre ${first.src} y ${first.gnd}, sin una resistencia en el camino. Un LED casi no frena la corriente por sí mismo: sin resistencia pasa mucha más de la que aguanta (unos ${el.ratedmA} mA) y se quema en segundos${first.gpio ? ', y además puede dañar el pin de la placa' : ''}.${now}`,
        fix: 'Pon una resistencia de 220 Ω a 1 kΩ en serie con el LED: entre el pin y la pata larga, o entre la pata corta y GND.',
        parts: [id],
        nets: first.nets.map((n) => netIdFor(ctx, n)),
      });
    } else if (overloaded && live) {
      ctx.issues.add({
        code: 'led-no-resistor',
        severity: 'error',
        title: `Demasiada corriente en ${name}`,
        message: `Por ${name} pasan ${fmtmA(live.currentA)}, pero aguanta como máximo ${el.maxmA} mA. La resistencia que lo protege es demasiado pequeña (o hay un camino que la evita), así que el LED se va a quemar.`,
        fix: 'Usa una resistencia más grande en serie con el LED (220 Ω o más con 5 V).',
        parts: [id],
      });
    }

    // --- reversed ---
    let reversed = !!live?.reversed;
    if (!reversed) {
      for (const ch of channels(rec)) {
        const a = sideOf(an, rec, ch.anode);
        const c = sideOf(an, rec, ch.cathode);
        if ((a === 'ground' && (c === 'supply' || c === 'gpio')) || (a === 'gpio' && c === 'supply')) reversed = true;
      }
    }
    if (reversed) {
      const rgb = el.model === 'rgb-led';
      ctx.issues.add({
        code: 'led-reversed',
        severity: 'warning',
        title: `${name} está al revés`,
        message: rgb
          ? `El LED RGB es de cátodo común: la pata larga («com») debe ir a GND (−) y las de color al pin o al + a través de una resistencia. Así como está, los diodos quedan en sentido contrario y la corriente no puede pasar.`
          : `Un LED es un diodo: deja pasar la corriente en un solo sentido, del ánodo (pata larga, +) al cátodo (pata corta, lado plano, −). Así como está, el ánodo quedó hacia el − y el LED no puede encenderse (no se daña, solo no prende).`,
        fix: rgb ? 'Gira el LED RGB para que la pata común quede hacia GND.' : `Gira ${name}: la pata larga hacia el + (o el pin), la corta hacia GND.`,
        parts: [id],
      });
    }
  }
}

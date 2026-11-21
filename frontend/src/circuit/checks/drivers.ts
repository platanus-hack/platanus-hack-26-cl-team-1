/** Driver checks: motors, transistors/common ground, inputs, servos, ESP32 pins. */
import type { Id } from '@/contracts';
import { isGroundNet, otherTerminal } from '../analysis';
import { sideOf } from '../bindings';
import { fmtV, label, netIdFor, type CheckContext } from './issues';
import { partsOnNet } from './structure';

const bindingOf = (ctx: CheckContext, part: Id) => ctx.bindings.find((b) => b.part === part && !b.channel);

export function motorChecks(ctx: CheckContext): void {
  const { an, topo } = ctx;
  for (const rec of topo.parts) {
    if (rec.def.electrical.model !== 'motor') continue;
    const b = bindingOf(ctx, rec.part.id);
    const name = label(rec);
    if (b?.boardPin && b.driver === 'direct') {
      const max = an.board?.profile.pinCurrent.maxmA ?? 40;
      ctx.issues.add({
        code: 'motor-direct-gpio',
        severity: 'error',
        title: `${name} conectado directo a un pin`,
        message: `${name} está conectado directo al pin ${b.boardPin}. Un pin de la placa entrega como máximo unos ${max} mA, pero un motor necesita cientos de mA (y al arrancar, aún más). El pin se sobrecarga y puede dañarse, y el motor apenas se mueve.`,
        fix: 'Controla el motor con un transistor NPN: el pin va a la base a través de una resistencia de 1 kΩ, el motor entre el + y el colector, y el emisor a GND. Agrega también un diodo en paralelo con el motor.',
        parts: [rec.part.id],
      });
    }
    // Flyback diode across the motor terminals (only matters when something switches it).
    if (!b?.boardPin) continue;
    const na = an.net(rec.part.id, 'a');
    const nb = an.net(rec.part.id, 'b');
    if (na < 0 || nb < 0 || na === nb) continue;
    const hasDiode = topo.parts.some((d) => {
      if (d.def.electrical.model !== 'diode') return false;
      const da = an.net(d.part.id, 'anode');
      const dc = an.net(d.part.id, 'cathode');
      return (da === na && dc === nb) || (da === nb && dc === na);
    });
    if (!hasDiode) {
      ctx.issues.add({
        code: 'missing-flyback',
        severity: 'info',
        title: `${name} sin diodo de protección`,
        message: `Un motor es una bobina: cuando el transistor lo apaga de golpe, la bobina genera un pico de voltaje al revés que puede dañar el transistor o reiniciar la placa. En la simulación no pasa, pero en la vida real sí.`,
        fix: `Pon un diodo (1N4007) en paralelo con ${name}: la franja plateada (cátodo) hacia el + y la otra pata hacia el colector del transistor.`,
        parts: [rec.part.id],
      });
    }
  }
}

/** A GPIO-switched NPN whose load runs from a battery that does not share GND with the board. */
export function commonGroundChecks(ctx: CheckContext): void {
  const { an, topo } = ctx;
  if (!an.board) return;
  for (const q of topo.parts) {
    if (q.def.electrical.model !== 'npn') continue;
    const driven = ctx.bindings.some((b) => b.boardPin && (b.part === q.part.id || b.via.includes(q.part.id)));
    if (!driven) continue;
    const ne = an.net(q.part.id, 'e');
    const nc = an.net(q.part.id, 'c');
    if (ne < 0 || nc < 0) continue;
    const bats = new Set<Id>(an.nets[ne].batMinus);
    for (const idx of an.nets[nc].pins) {
      const pin = topo.pins[idx];
      const load = topo.parts[pin.part];
      if (load === q || load.bus || load.board) continue;
      const other = otherTerminal(load, pin.def.id);
      const info = other ? an.info(load.part.id, other) : null;
      for (const bat of info?.batPlus ?? []) bats.add(bat);
    }
    for (const batId of bats) {
      const bat = topo.partById.get(batId);
      if (!bat) continue;
      const minus = an.info(batId, 'minus');
      if (!minus || minus.ground) continue;
      ctx.issues.add({
        code: 'no-common-ground',
        severity: 'error',
        title: 'Falta unir las tierras (GND)',
        message: `${label(q)} se controla desde la placa, pero ${label(bat)} tiene su polo − separado del GND de la placa. La corriente de la base sale del pin y necesita volver a la placa por GND; sin una tierra común no hay camino de vuelta y el transistor nunca se activa.`,
        fix: `Une con un cable el polo − de ${label(bat)} con un pin GND de la placa (y el emisor del transistor a esa misma tierra).`,
        parts: [q.part.id, batId],
      });
    }
  }
}

/** Has a resistor from `net` to ground (pull-down)? */
function hasPullDown(ctx: CheckContext, net: number): boolean {
  if (net < 0) return false;
  for (const idx of ctx.an.nets[net].pins) {
    const pin = ctx.topo.pins[idx];
    const r = ctx.topo.parts[pin.part];
    if (r.def.electrical.model !== 'resistor') continue;
    const other = otherTerminal(r, pin.def.id);
    const info = other ? ctx.an.info(r.part.id, other) : null;
    if (info && isGroundNet(info)) return true;
  }
  return false;
}

export function inputChecks(ctx: CheckContext): void {
  const { an, topo } = ctx;
  const board = an.board;
  if (!board) return;
  for (const b of ctx.bindings) {
    if (!b.boardPin || b.mode !== 'INPUT') continue;
    const rec = topo.partById.get(b.part);
    if (!rec || rec.def.electrical.model !== 'switch') continue;
    if (rec.def.electrical.kind === 'slide') {
      const a = sideOf(an, rec, 'a');
      const bb = sideOf(an, rec, 'b');
      if (a !== 'none' && bb !== 'none') continue; // both throws defined: never floats
    }
    const gpioNet = an.net(board.rec.part.id, b.boardPin);
    if (hasPullDown(ctx, gpioNet) || hasPullDown(ctx, an.net(rec.part.id, b.pin))) continue;
    ctx.issues.add({
      code: 'floating-input',
      severity: 'warning',
      title: `Entrada flotante en ${b.boardPin}`,
      message: `${label(rec)} une el pin ${b.boardPin} con el +, pero cuando está suelto el pin queda «al aire»: no está conectado ni a + ni a GND. Una entrada al aire capta ruido y lee 0 y 1 al azar, así que el programa verá pulsaciones fantasma.`,
      fix: `Agrega una resistencia de 10 kΩ entre ${b.boardPin} y GND (resistencia pull-down), o conecta el otro lado de ${label(rec)} a GND y usa el modo INPUT_PULLUP.`,
      parts: [rec.part.id],
      nets: gpioNet >= 0 ? [netIdFor(ctx, gpioNet)] : undefined,
    });
  }
}

export function servoChecks(ctx: CheckContext): void {
  const { an, topo, result } = ctx;
  for (const rec of topo.parts) {
    const el = rec.def.electrical;
    if (el.model !== 'servo') continue;
    const vcc = an.info(rec.part.id, 'vcc');
    const gnd = an.info(rec.part.id, 'gnd');
    if (!vcc || !gnd) continue;
    const name = label(rec);
    let message: string | null = null;
    if (vcc.rails.includes('3V3')) {
      message = `El cable rojo (V+) de ${name} está en 3,3 V. Un servo SG90 necesita entre 4,8 y 6 V para moverse con fuerza: con 3,3 V tiembla, se queda sin fuerza o no se mueve.`;
    } else if (vcc.gpios.length) {
      message = `El cable rojo (V+) de ${name} está en el pin ${vcc.gpios[0]}. Un pin solo entrega unos pocos mA y el servo pide cientos de mA al moverse: el pin se sobrecarga y el servo no se mueve bien.`;
    } else if (result && vcc.parts.length + vcc.wires.length > 1) {
      const live = result.parts[rec.part.id];
      if (live && !live.burned && live.voltage < el.minVolts && Math.abs(live.voltage) > 0.05) {
        message = `${name} recibe solo ${fmtV(live.voltage)} entre V+ y GND, y necesita al menos ${el.minVolts} V para funcionar.`;
      }
    }
    if (!message) continue;
    ctx.issues.add({
      code: 'servo-power',
      severity: 'warning',
      title: `${name} sin energía suficiente`,
      message,
      fix: 'Conecta el cable rojo del servo a 5V y el café a GND; la señal (naranja) va al pin de control.',
      parts: [rec.part.id],
    });
  }
}

export function strappingChecks(ctx: CheckContext): void {
  const { an } = ctx;
  const board = an.board;
  if (!board) return;
  for (const bp of board.profile.pins) {
    if (bp.aliasOf || !bp.caps?.includes('strapping')) continue;
    const net = an.net(board.rec.part.id, bp.id);
    const parts = partsOnNet(ctx, net);
    const bound = ctx.bindings.filter((b) => b.boardPin === bp.id).map((b) => b.part);
    const users = [...new Set([...bound, ...parts])];
    if (users.length === 0) continue;
    ctx.issues.add({
      code: 'strapping-pin',
      severity: 'info',
      title: `${bp.id} es un pin de arranque`,
      message: `${bp.id} es un pin «strapping» de ${board.profile.name}: al encender, la placa lee su nivel para decidir cómo arrancar. Si lo que conectaste lo fuerza a un nivel equivocado, la placa puede no iniciar tu programa o quedar esperando una carga.${bp.notes ? ` ${bp.notes}` : ''}`,
      fix: 'Si puedes, usa otro GPIO que no sea de arranque (por ejemplo GPIO6, GPIO7, GPIO10, GPIO11 o GPIO18–23).',
      parts: [board.rec.part.id, ...users],
      idSuffix: bp.id,
    });
  }
}

/** Static: a GPIO in the same net as a higher-voltage supply (5 V into a 3,3 V pin, a battery…). */
export function staticOvervoltageChecks(ctx: CheckContext): void {
  const { an, topo } = ctx;
  const board = an.board;
  if (!board) return;
  const logic = board.profile.logicVoltage;
  for (const info of an.nets) {
    if (!info.gpios.length) continue;
    let volts = 0;
    let source = '';
    for (const rail of info.rails) {
      const r = board.profile.supply.rails.find((x) => board.canonical(x.pin) === rail);
      if (r && r.volts > volts) {
        volts = r.volts;
        source = `el pin ${rail}`;
      }
    }
    for (const batId of info.batPlus) {
      const bat = topo.partById.get(batId);
      const el = bat?.def.electrical;
      if (bat && el?.model === 'battery' && el.voltage > volts) {
        volts = el.voltage;
        source = label(bat);
      }
    }
    if (volts <= logic + 0.3) continue;
    for (const gpio of info.gpios) overvoltageIssue(ctx, gpio, volts, source);
  }
}

export function overvoltageIssue(ctx: CheckContext, gpio: string, volts: number, source?: string): void {
  const board = ctx.an.board;
  if (!board) return;
  const logic = board.profile.logicVoltage;
  const net = ctx.an.net(board.rec.part.id, gpio);
  const from = source ? ` (viene de ${source})` : '';
  const negative = volts < 0;
  ctx.issues.add({
    code: 'pin-overvoltage',
    severity: 'error',
    title: `Voltaje peligroso en ${gpio}`,
    message: negative
      ? `El pin ${gpio} está a ${fmtV(volts)}: por debajo de GND. Los pines solo soportan voltajes entre 0 V y ${fmtV(logic)}; un voltaje negativo puede dañar el microcontrolador.`
      : `El pin ${gpio} recibe ${fmtV(volts)}${from}, pero ${board.profile.name} trabaja a ${fmtV(logic)} y sus pines aguantan como máximo ${fmtV(logic + 0.3)}. Un voltaje mayor puede quemar el pin o el chip completo.`,
    fix:
      logic < 4
        ? 'Usa la salida 3V3 en vez de 5V para lo que se conecta a los pines, o baja el voltaje con un divisor de resistencias (por ejemplo 1 kΩ y 2,2 kΩ).'
        : 'No conectes los pines a más de 5 V: una batería de 9 V debe ir a VIN o a un circuito con transistor, nunca a un pin.',
    parts: [board.rec.part.id, ...partsOnNet(ctx, net)],
    nets: net >= 0 ? [netIdFor(ctx, net)] : undefined,
    idSuffix: gpio,
  });
}


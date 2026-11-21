/** Structural checks: boards, static shorts, unconnected parts/pins, bypassed parts. */
import type { Id } from '@/contracts';
import { pinConnected } from '../analysis';
import { boardRecs } from '../board';
import { wirePath } from '../paths';
import type { PartRec } from '../topology';
import { holeOf, label, netIdFor, pinLabel, stripOf, type CheckContext } from './issues';

export function boardChecks(ctx: CheckContext): void {
  const boards = boardRecs(ctx.topo);
  if (boards.length === 0) {
    ctx.issues.add({
      code: 'no-board',
      severity: 'info',
      title: 'Sin placa programable',
      message:
        'Tu circuito no tiene Arduino ni ESP32. La parte eléctrica (pilas, LED, resistencias…) se simula igual, pero los bloques de programación necesitan una placa que ejecute el programa.',
      fix: 'Si quieres programar, agrega un Arduino Uno o un ESP32-C6 desde la paleta.',
      parts: [],
    });
  } else if (boards.length > 1) {
    const [first, ...rest] = boards;
    ctx.issues.add({
      code: 'multiple-boards',
      severity: 'error',
      title: 'Hay más de una placa',
      message: `Solo ${label(first)} está encendida y ejecuta el programa; ${rest.map(label).join(', ')} queda apagada y sus pines no hacen nada. Este editor programa una sola placa a la vez.`,
      fix: 'Deja una sola placa en el proyecto (borra las demás).',
      parts: boards.map((b) => b.part.id),
    });
  }
}

/** A supply whose + and − share a net (wire or strip straight from + to −). */
export function staticShortChecks(ctx: CheckContext): void {
  const { an, topo } = ctx;
  const check = (rec: PartRec, plus: string, minus: string, what: string) => {
    const p = rec.pins.get(plus);
    const m = rec.pins.get(minus);
    if (p === undefined || m === undefined || topo.net[p] !== topo.net[m]) return;
    const path = wirePath(topo, p, m) ?? [];
    ctx.issues.add({
      code: 'short-circuit',
      severity: 'error',
      title: '¡Cortocircuito!',
      message: `${what} están unidos directamente, sin ningún componente en medio. La corriente toma ese atajo sin nada que la frene: sube a varios amperes, los cables se calientan y la fuente se apaga o se daña. Por eso el resto del circuito se queda sin energía.`,
      fix: 'Busca el cable (o la fila de la protoboard) que une el + con el − y quítalo: entre ambos siempre debe haber un componente, como una resistencia y un LED.',
      parts: [rec.part.id],
      wires: path.map((s) => s.wire),
      nets: [netIdFor(ctx, topo.net[p])],
    });
  };
  const board = an.board;
  if (board?.gndPin) {
    for (const rail of board.rails) check(board.rec, rail, board.gndPin, `El pin ${rail} y GND de ${label(board.rec)}`);
  }
  for (const rec of topo.parts) {
    if (rec.def.electrical.model === 'battery') check(rec, 'plus', 'minus', `Los polos + y − de ${label(rec)}`);
  }
}

/** Pins that must be connected for the part to work (groups: any pin of the group counts). */
function requiredGroups(rec: PartRec): string[][] | null {
  const el = rec.def.electrical;
  switch (el.model) {
    case 'led':
    case 'diode':
      return [['anode'], ['cathode']];
    case 'resistor':
    case 'ldr':
    case 'motor':
      return [['a'], ['b']];
    case 'buzzer':
    case 'battery':
      return [['plus'], ['minus']];
    case 'npn':
      return [['c'], ['b'], ['e']];
    case 'servo':
      return [['gnd'], ['vcc'], ['signal']];
    case 'switch':
      return el.kind === 'push'
        ? [
            ['a1', 'a2'],
            ['b1', 'b2'],
          ]
        : [['com'], ['a', 'b']];
    case 'potentiometer':
      return [['wiper'], ['a', 'b']];
    case 'rgb-led':
      return [['com'], ['r', 'g', 'b']];
    default:
      return null;
  }
}

/** Main terminal pairs whose union means the part is bypassed (shorted by the breadboard / a wire). */
function bypassPairs(rec: PartRec): Array<[string, string]> {
  const el = rec.def.electrical;
  switch (el.model) {
    case 'led':
    case 'diode':
      return [['anode', 'cathode']];
    case 'resistor':
    case 'ldr':
    case 'motor':
      return [['a', 'b']];
    case 'buzzer':
      return [['plus', 'minus']];
    case 'potentiometer':
      return [['a', 'b']];
    case 'switch':
      return el.kind === 'push' ? [['a1', 'b1']] : [];
    case 'rgb-led':
      return [
        ['r', 'com'],
        ['g', 'com'],
        ['b', 'com'],
      ];
    default:
      return [];
  }
}

function bypassMessage(ctx: CheckContext, rec: PartRec, a: string, b: string): { message: string; fix: string } {
  const ha = holeOf(ctx.topo, rec, a);
  const hb = holeOf(ctx.topo, rec, b);
  const name = label(rec);
  const where =
    ha && hb && stripOf(ha) === stripOf(hb)
      ? `Las patas «${pinLabel(rec, a)}» (${ha}) y «${pinLabel(rec, b)}» (${hb}) están en ${stripOf(ha)}, y por dentro de la protoboard esos agujeros son una sola tira de metal.`
      : `Las patas «${pinLabel(rec, a)}» y «${pinLabel(rec, b)}» quedaron unidas entre sí (por un cable o por la misma tira de la protoboard).`;
  const model = rec.def.electrical.model;
  const effect =
    model === 'switch'
      ? 'Es como si el botón estuviera siempre presionado: apretarlo no cambia nada.'
      : model === 'led' || model === 'rgb-led'
        ? 'La corriente prefiere el atajo de metal y se salta el LED, así que nunca se enciende.'
        : 'La corriente toma ese atajo y se salta el componente: es como si no estuviera.';
  const fix =
    ha && hb && stripOf(ha) === stripOf(hb)
      ? `Gira ${name} para que cada pata quede en una columna distinta de la protoboard (por ejemplo, cruzando de una columna a la siguiente o sobre el canal central).`
      : `Revisa los cables de ${name}: cada pata debe ir a un punto distinto del circuito.`;
  return { message: `${where} ${effect}`, fix };
}

export function connectionChecks(ctx: CheckContext): void {
  const { an, topo } = ctx;
  for (const rec of topo.parts) {
    if (rec.bus || rec.board) continue;
    const groups = requiredGroups(rec);
    if (!groups) continue;
    const nets = (pin: string) => an.net(rec.part.id, pin);

    // Bypassed: two main terminals in the same net.
    let bypassed = false;
    for (const [a, b] of bypassPairs(rec)) {
      const na = nets(a);
      if (na < 0 || na !== nets(b)) continue;
      bypassed = true;
      const { message, fix } = bypassMessage(ctx, rec, a, b);
      ctx.issues.add({
        code: 'part-bypassed',
        severity: 'warning',
        title: `${label(rec)} está puenteado`,
        message,
        fix,
        parts: [rec.part.id],
        nets: [netIdFor(ctx, na)],
      });
      break;
    }

    const connected = rec.def.pins.filter((p) => pinConnected(an, rec, p.id)).map((p) => p.id);
    if (connected.length === 0) {
      if (bypassed) continue;
      ctx.issues.add({
        code: 'unconnected-part',
        severity: 'info',
        // Gender-neutral wording: labels can be feminine/plural ('Batería 9V 1', 'Pilas 4xAA 1').
        title: `${label(rec)} sin conectar`,
        message: `Ninguna pata de ${label(rec)} toca otro componente ni un cable, así que no forma parte del circuito y no le llega corriente.`,
        fix: 'Pon sus patas en la protoboard junto a otros componentes, o conéctalas con cables.',
        parts: [rec.part.id],
      });
      continue;
    }
    const missing: string[] = [];
    for (const g of groups) if (!g.some((p) => connected.includes(p))) missing.push(g[0]);
    if (missing.length === 0) continue;
    const names = missing.map((p) => `«${pinLabel(rec, p)}»`);
    ctx.issues.add({
      code: 'unconnected-pin',
      severity: 'warning',
      title: `${label(rec)}: ${missing.length === 1 ? 'una pata sin conectar' : 'patas sin conectar'}`,
      message: `${missing.length === 1 ? 'La pata' : 'Las patas'} ${names.join(' y ')} de ${label(rec)} no ${missing.length === 1 ? 'está conectada' : 'están conectadas'} a nada. La corriente necesita un camino completo (un circuito cerrado) para circular: con una pata al aire, ${label(rec)} no funciona.`,
      fix: 'Conecta esa pata con un cable, o ponla en una columna de la protoboard que vaya al resto del circuito.',
      parts: [rec.part.id],
    });
  }
}

export const partsOnNet = (ctx: CheckContext, net: number, exclude: Id[] = []): Id[] =>
  net < 0
    ? []
    : ctx.an.nets[net].parts.filter((p) => !exclude.includes(p) && !ctx.topo.partById.get(p)?.board && !ctx.topo.partById.get(p)?.bus);

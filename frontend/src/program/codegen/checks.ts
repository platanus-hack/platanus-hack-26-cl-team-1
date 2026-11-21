/**
 * Program-level educational checks (merged with circuit checks by
 * store/derived getIssues). Spanish, stable ids `${code}:${parts}`.
 */
import type { BoardProfile, CheckIssue, Id, PinCap, ProgramIR } from '@/contracts';
import type { ProgramContext } from '../context';
import { canonicalPin, findPart, partLabel, pinDisplay, pinHasCap, planSetup, resolveGenericPin, resolvePart, RGB_CHANNELS } from './shared';
import { visitProgram } from './walk';

function pinsWithCap(board: BoardProfile, cap: PinCap, exclude: string[] = []): string {
  const pins = board.pins
    .filter((p) => p.kind === 'gpio' && !p.aliasOf && p.caps?.includes(cap) && !exclude.includes(p.id))
    .sort((a, b) => (a.gpio ?? 0) - (b.gpio ?? 0));
  return pins.map((p) => (/^GPIO/.test(p.id) ? p.id : p.codeName ?? p.label)).join(', ');
}

const listJoin = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

function wiringHint(type: string | undefined, board: BoardProfile): string {
  const analog = pinsWithCap(board, 'analog');
  const pwm = pinsWithCap(board, 'pwm');
  const vcc = board.logicVoltage >= 5 ? '5V' : '3V3';
  switch (type) {
    case 'led':
      return 'Conecta el ánodo (pata larga) a un pin digital a través de una resistencia de 220 Ω, y el cátodo (pata corta) a GND.';
    case 'led-rgb':
      return `Conecta cada color (R, G y B) a un pin con PWM (${pwm}) a través de su propia resistencia, y la pata común a GND.`;
    case 'buzzer':
      return 'Conecta la pata + del zumbador a un pin digital y la pata − a GND.';
    case 'motor-dc':
      return `Un motor necesita un transistor: conecta la base del transistor a un pin con PWM (${pwm}) a través de una resistencia de 1 kΩ.`;
    case 'servo-sg90':
      return 'Conecta el cable de señal (naranja) a un pin digital, el rojo a 5V y el café a GND.';
    case 'button':
      return 'Conecta una pata del botón a un pin digital y la pata del lado opuesto a GND.';
    case 'switch-slide':
      return 'Conecta la pata central (común) del interruptor a un pin digital y uno de los extremos a GND.';
    case 'potentiometer':
      return `Conecta la pata central del potenciómetro a un pin analógico (${analog}) y las otras dos a ${vcc} y GND.`;
    case 'ldr':
      return `Arma un divisor de voltaje (LDR + resistencia de 10 kΩ) y conecta el punto medio a un pin analógico (${analog}).`;
    default:
      return 'Conecta su pin de señal a un pin de la placa (directo o a través de una resistencia).';
  }
}

interface PwmUse {
  pin: string; // canonical
  part?: Id;
  who: string; // '«LED 1»' / 'El bloque analogWrite'
}

export function programChecks(ir: ProgramIR, ctx: ProgramContext): CheckIssue[] {
  const board = ctx.board;
  if (!board || !ir) return [];
  const issues = new Map<string, CheckIssue>();
  const add = (i: CheckIssue) => {
    if (!issues.has(i.id)) issues.set(i.id, i);
  };
  const boardParts = ctx.boardPartId ? [ctx.boardPartId] : [];
  const boardKey = ctx.boardPartId ?? board.id;
  const plan = planSetup(ir, ctx, board);

  /* block-unbound ------------------------------------------------------- */
  for (const id of plan.unboundParts) {
    const part = findPart(ctx, id);
    const usage = plan.parts.find((u) => u.part === id);
    const reads = usage ? [...usage.kinds].some((k) => ['buttonPressed', 'buttonClicked', 'switchOn', 'potPercent', 'lightPercent', 'analogRaw'].includes(k)) : false;
    if (!part) {
      add({
        id: `block-unbound:${id}`,
        code: 'block-unbound',
        severity: 'warning',
        title: `Falta el componente «${id}»`,
        message: `El programa usa «${id}», pero ese componente ya no está en el circuito, así que sus bloques no harán nada.`,
        fix: 'Borra esos bloques o vuelve a agregar el componente.',
        parts: [id],
      });
      continue;
    }
    const label = partLabel(ctx, id);
    add({
      id: `block-unbound:${id}`,
      code: 'block-unbound',
      severity: 'warning',
      title: `«${label}» no está conectado a la placa`,
      message: `Tu programa usa «${label}», pero ninguno de sus pines llega a un pin de la placa (ni directo ni a través de una resistencia). La placa no puede ${reads ? 'leer' : 'controlar'} algo que no está conectado, así que esos bloques no harán nada.`,
      fix: wiringHint(part.type, board),
      parts: [id],
    });
  }

  /* collect pin uses ------------------------------------------------------ */
  const pwmUses: PwmUse[] = [];
  const tonePins = new Map<string, Id | undefined>();
  const analogParts = new Set<Id>();
  let onboardRgb = false;
  let onboardLed = false;

  visitProgram(ir, {
    stmt: (s) => {
      switch (s.k) {
        case 'ledBrightness':
        case 'motor': {
          const r = resolvePart(ctx, board, s.part);
          if (r) pwmUses.push({ pin: r.boardPin, part: s.part, who: `«${partLabel(ctx, s.part)}»` });
          break;
        }
        case 'rgb':
          for (const ch of RGB_CHANNELS) {
            const r = resolvePart(ctx, board, s.part, ch);
            if (r) pwmUses.push({ pin: r.boardPin, part: s.part, who: `El canal ${ch.toUpperCase()} de «${partLabel(ctx, s.part)}»` });
          }
          break;
        case 'buzzerTone': {
          const r = resolvePart(ctx, board, s.part);
          if (r) tonePins.set(r.boardPin, s.part);
          break;
        }
        case 'analogWrite':
        case 'tone': {
          const g = resolveGenericPin(board, s.pin);
          if (!g) break;
          if (s.k === 'tone') {
            if (!tonePins.has(g.boardPin)) tonePins.set(g.boardPin, undefined);
          } else pwmUses.push({ pin: g.boardPin, who: `El bloque analogWrite del ${pinDisplay(board, g.boardPin)}` });
          break;
        }
        case 'onboardRgb':
          onboardRgb = true;
          break;
        case 'onboardLed':
          onboardLed = true;
          break;
      }
      if ('pin' in s && typeof s.pin === 'string' && !resolveGenericPin(board, s.pin)) unknownPin(s.pin);
    },
    expr: (e) => {
      if (e.k === 'potPercent' || e.k === 'lightPercent' || e.k === 'analogRaw') analogParts.add(e.part);
      if (e.k === 'analogRead') {
        const g = resolveGenericPin(board, e.pin);
        if (!g) unknownPin(e.pin);
        else if (!pinHasCap(g.def, 'analog')) {
          add({
            id: `pin-not-analog:${boardKey}.${g.boardPin}`,
            code: 'pin-not-analog',
            severity: 'error',
            title: `El ${pinDisplay(board, g.boardPin)} no es analógico`,
            message: `El bloque «leer analógico» usa el ${pinDisplay(board, g.boardPin)}, que solo entiende encendido/apagado (digital). Para medir valores intermedios (0..${board.adc.maxValue}) hace falta un pin con convertidor analógico.`,
            fix: `Usa uno de estos pines: ${pinsWithCap(board, 'analog')}.`,
            parts: boardParts,
          });
        }
      }
      if (e.k === 'digitalRead' && !resolveGenericPin(board, e.pin)) unknownPin(e.pin);
    },
  });

  function unknownPin(pin: string) {
    add({
      id: `block-unsupported-board:pin.${pin}`,
      code: 'block-unsupported-board',
      severity: 'warning',
      title: `El pin ${pin} no existe en ${board!.name}`,
      message: `Un bloque usa el pin «${pin}», que no existe (o no es un pin de entrada/salida) en ${board!.name}. Puede pasar al cambiar de placa: ese bloque se omitirá.`,
      fix: 'Elige otro pin en el bloque.',
      parts: boardParts,
    });
  }

  /* pin-not-analog (parts) ---------------------------------------------- */
  for (const id of analogParts) {
    const r = resolvePart(ctx, board, id);
    if (!r || pinHasCap(r.def, 'analog')) continue;
    const label = partLabel(ctx, id);
    add({
      id: `pin-not-analog:${id}`,
      code: 'pin-not-analog',
      severity: 'error',
      title: `«${label}» está en un pin que no es analógico`,
      message: `«${label}» entrega un voltaje que cambia de a poco, pero está conectado al ${pinDisplay(board, r.boardPin)}, que solo distingue encendido/apagado. Así la lectura no tendrá sentido.`,
      fix: `Muévelo a un pin analógico: ${pinsWithCap(board, 'analog')}.`,
      parts: [id],
    });
  }

  /* pin-not-pwm --------------------------------------------------------- */
  for (const u of pwmUses) {
    const def = board.pins.find((p) => p.id === u.pin);
    if (pinHasCap(def, 'pwm')) continue;
    const key = u.part ?? `${boardKey}.${u.pin}`;
    add({
      id: `pin-not-pwm:${key}`,
      code: 'pin-not-pwm',
      severity: 'warning',
      title: `${pinDisplay(board, u.pin)} sin PWM`,
      message: `${u.who} intenta dar valores intermedios (brillo, velocidad o color) en el ${pinDisplay(board, u.pin)}, pero ese pin no tiene PWM: solo puede quedar totalmente encendido (valor ≥ 128) o apagado.`,
      fix: `Usa un pin con PWM${board.id === 'uno' ? ' (marcados con ~ en la placa)' : ''}: ${pinsWithCap(board, 'pwm')}.`,
      parts: u.part ? [u.part] : boardParts,
    });
  }

  /* block-unsupported-board --------------------------------------------- */
  if (onboardRgb && !board.onboard.some((o) => o.kind === 'rgb-ws2812')) {
    add({
      id: 'block-unsupported-board:onboardRgb',
      code: 'block-unsupported-board',
      severity: 'warning',
      title: `${board.name} no tiene LED RGB integrado`,
      message: `El bloque «LED RGB integrado» es para placas que traen un LED de colores (como el ESP32-C6). ${board.name} no tiene uno, así que el bloque se omitirá.`,
      fix: 'Usa un LED RGB externo (componente «LED RGB») o el bloque «LED integrado».',
      parts: boardParts,
    });
  }
  if (onboardLed && board.onboard.every((o) => o.kind !== 'led' && o.kind !== 'rgb-ws2812')) {
    add({
      id: 'block-unsupported-board:onboardLed',
      code: 'block-unsupported-board',
      severity: 'warning',
      title: `${board.name} no tiene LED integrado`,
      message: `El bloque «LED integrado» no tiene efecto en ${board.name}.`,
      fix: 'Conecta un LED externo con su resistencia.',
      parts: boardParts,
    });
  }

  /* timer-conflict ------------------------------------------------------ */
  const servoParts = plan.servos.map((s) => s.part);
  const toneParts = [...new Set([...tonePins.values()].filter((p): p is Id => !!p))];
  const active = { servo: servoParts.length > 0, tone: tonePins.size > 0 };
  const disabled = board.conflicts.filter((c) => active[c.when]).flatMap((c) => c.disablesPwm.map((p) => canonicalPin(board, p)));
  for (const c of board.conflicts) {
    if (!active[c.when]) continue;
    const pins = c.disablesPwm.map((p) => canonicalPin(board, p));
    const causes = c.when === 'servo' ? servoParts : toneParts;
    for (const u of pwmUses) {
      const def = board.pins.find((p) => p.id === u.pin);
      if (!pins.includes(u.pin) || !pinHasCap(def, 'pwm')) continue;
      const parts = [...new Set([u.part ?? ctx.boardPartId ?? '', ...causes].filter(Boolean))];
      add({
        id: `timer-conflict:${parts.join(',')}`,
        code: 'timer-conflict',
        severity: 'warning',
        title: `Conflicto de temporizador en el ${pinDisplay(board, u.pin)}`,
        message: `${c.message} ${u.who} usa PWM en el ${pinDisplay(board, u.pin)}: ${c.when === 'servo' ? 'el servo' : 'el tono'} usa el mismo temporizador interno, así que ahí solo quedará encendido (≥ 128) o apagado.`,
        fix: `Mueve ${u.who.startsWith('«') ? u.who : 'esa salida'} a otro pin con PWM: ${pinsWithCap(board, 'pwm', disabled) || 'ninguno libre'}.`,
        parts,
      });
    }
  }
  /* shared PWM channels (ESP32-C6 LEDC: analogWrite + tone + servos) -------- */
  if (board.maxPwmChannels !== undefined) {
    // Every distinct pin written with PWM, driving a servo or playing a tone holds one channel.
    const owners = new Map<string, Id | undefined>();
    for (const u of pwmUses) if (!owners.has(u.pin)) owners.set(u.pin, u.part);
    for (const s of plan.servos) if (!owners.has(s.boardPin)) owners.set(s.boardPin, s.part);
    for (const [pin, part] of tonePins) if (!owners.has(pin)) owners.set(pin, part);
    if (owners.size > board.maxPwmChannels) {
      const parts = [...new Set([...owners.values()].filter((p): p is Id => !!p))];
      add({
        id: `timer-conflict:pwm-channels:${parts.join(',') || boardKey}`,
        code: 'timer-conflict',
        severity: 'warning',
        title: `${board.name} solo tiene ${board.maxPwmChannels} canales PWM`,
        message: `Tu programa usa ${owners.size} pines con PWM (brillo, colores, velocidad, servos o tonos), pero ${board.name} solo puede generar ${board.maxPwmChannels} señales PWM a la vez. Las que no alcancen un canal no funcionarán en la placa real (quedarán apagadas).`,
        fix: `Usa como máximo ${board.maxPwmChannels} pines con PWM: por ejemplo, enciende y apaga algunos LED con «LED encender/apagar» en vez de darles brillo.`,
        parts: parts.length ? parts : boardParts,
      });
    }
  }

  if (board.maxConcurrentTones !== undefined && tonePins.size > board.maxConcurrentTones) {
    const names = [...tonePins].map(([pin, part]) => (part ? `«${partLabel(ctx, part)}»` : `el ${pinDisplay(board, pin)}`));
    const parts = toneParts.length ? toneParts : boardParts;
    add({
      id: `timer-conflict:${parts.join(',')}`,
      code: 'timer-conflict',
      severity: 'warning',
      title: `${board.name} solo genera ${board.maxConcurrentTones === 1 ? 'un tono' : `${board.maxConcurrentTones} tonos`} a la vez`,
      message: `Tu programa hace sonar ${listJoin(names)}. ${board.name} tiene un solo temporizador para tone(): mientras suena uno, los demás se quedan en silencio.`,
      fix: 'Llama a «silenciar» (noTone) antes de hacer sonar otro pin, o usa un solo zumbador.',
      parts,
    });
  }

  return [...issues.values()];
}

// C172 instrument panel drawn into the cockpit canvas (owner: Anaís). The six main instruments are the
// vendored flight-indicators-js SVG layers drawn as rotated images; everything else is drawn here.
// Layout is in a 1280×960 frame; the VLM sees it at 640×480, so controls are drawn large and high-contrast.
// Placards are English, like the real aircraft (UI copy around the canvas is Spanish).
import type { Sim } from './model';
import { RUNWAY_HEADING } from './model';

const LAYERS = [
  'fi_box',
  'fi_circle',
  'fi_needle',
  'fi_needle_small',
  'fi_tc_airplane',
  'heading_mechanics',
  'heading_yaw',
  'horizon_back',
  'horizon_ball',
  'horizon_circle',
  'horizon_mechanics',
  'speed_mechanics',
  'turn_coordinator',
  'vertical_mechanics',
  'altitude_pressure',
  'altitude_ticks',
] as const;
type Layer = (typeof LAYERS)[number];
export type PanelImages = Record<Layer, HTMLImageElement>;

const urls = import.meta.glob('./instruments/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

export async function loadPanelImages(): Promise<PanelImages> {
  const entries = await Promise.all(
    LAYERS.map(async (name) => {
      const url = urls[`./instruments/${name}.svg`];
      if (!url) throw new Error(`instrument image missing: ${name}.svg`);
      const img = new Image();
      img.src = url;
      await img.decode();
      return [name, img] as const;
    }),
  );
  return Object.fromEntries(entries) as PanelImages;
}

export const PANEL_TOP = 430;
const S = 158; // six-pack instrument size
const COL = [330, 500, 670];
const ROW = [548, 718];

const deg = (d: number) => (d * Math.PI) / 180;

function layer(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, size: number, rot = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(deg(rot));
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 13, color = '#e9e6dc') {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function screw(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
  g.addColorStop(0, '#9a9ea3');
  g.addColorStop(1, '#3b3e42');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#25272a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 3, y);
  ctx.lineTo(x + 3, y);
  ctx.stroke();
}

let panelTexture: HTMLCanvasElement | null = null;
function panelFace(w: number, h: number): HTMLCanvasElement {
  if (panelTexture) return panelTexture;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#3a3e43');
  g.addColorStop(1, '#25282c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const v = ctx.createRadialGradient(w / 2, h * 0.35, h * 0.2, w / 2, h * 0.4, w * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  panelTexture = c;
  return c;
}

// ── six-pack ───────────────────────────────────────────────────────────────

function sixPack(ctx: CanvasRenderingContext2D, im: PanelImages, sim: Sim) {
  const f = sim.flight;
  const [x1, x2, x3] = COL;
  const [y1, y2] = ROW;

  // Airspeed: the library's mapping is rotate(90 + 2·kt).
  layer(ctx, im.fi_box, x1, y1, S);
  layer(ctx, im.speed_mechanics, x1, y1, S);
  layer(ctx, im.fi_needle, x1, y1, S, 90 + 2 * Math.min(160, f.airspeedKt));
  layer(ctx, im.fi_circle, x1, y1, S);

  // Attitude: the ball moves pitch·0.7 % of the instrument size.
  layer(ctx, im.fi_box, x2, y1, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x2, y1, S * 0.38, 0, Math.PI * 2);
  ctx.clip();
  layer(ctx, im.horizon_back, x2, y1, S);
  const pitch = Math.max(-30, Math.min(30, f.pitchDeg));
  ctx.drawImage(im.horizon_ball, x2 - S / 2, y1 - S / 2 + (pitch * 0.7 * S) / 100, S, S);
  ctx.restore();
  layer(ctx, im.horizon_circle, x2, y1, S);
  layer(ctx, im.horizon_mechanics, x2, y1, S);
  layer(ctx, im.fi_circle, x2, y1, S);

  // Altimeter (pressure 1013 hPa).
  layer(ctx, im.fi_box, x3, y1, S);
  layer(ctx, im.altitude_pressure, x3, y1, S, 2 * 1013 - 1980);
  layer(ctx, im.altitude_ticks, x3, y1, S);
  layer(ctx, im.fi_needle_small, x3, y1, S, (f.altitudeFt / 10000) * 360);
  layer(ctx, im.fi_needle, x3, y1, S, 90 + ((f.altitudeFt % 1000) * 360) / 1000);
  layer(ctx, im.fi_circle, x3, y1, S);

  // Turn coordinator (wings level).
  layer(ctx, im.fi_box, x1, y2, S);
  layer(ctx, im.turn_coordinator, x1, y2, S);
  layer(ctx, im.fi_tc_airplane, x1, y2, S, 0);
  layer(ctx, im.fi_circle, x1, y2, S);

  // Heading indicator.
  layer(ctx, im.fi_box, x2, y2, S);
  layer(ctx, im.heading_yaw, x2, y2, S, -RUNWAY_HEADING);
  layer(ctx, im.heading_mechanics, x2, y2, S);
  layer(ctx, im.fi_circle, x2, y2, S);

  // Vertical speed: rotate(90° per 1000 ft/min), bounded at ±1950.
  layer(ctx, im.fi_box, x3, y2, S);
  layer(ctx, im.vertical_mechanics, x3, y2, S);
  layer(ctx, im.fi_needle, x3, y2, S, (Math.max(-1950, Math.min(1950, f.vsFpm)) / 1000) * 90);
  layer(ctx, im.fi_circle, x3, y2, S);
}

// ── round gauge helpers ────────────────────────────────────────────────────

function bezel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const g = ctx.createRadialGradient(x, y - r * 0.3, r * 0.2, x, y, r * 1.12);
  g.addColorStop(0, '#5b5f64');
  g.addColorStop(1, '#141517');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0c0d0e';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function needle(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, angleDeg: number, width = 4) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(deg(angleDeg));
  ctx.fillStyle = '#f4f2ea';
  ctx.beginPath();
  ctx.moveTo(-width / 2, len * 0.15);
  ctx.lineTo(0, -len);
  ctx.lineTo(width / 2, len * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#2a2c2f';
  ctx.beginPath();
  ctx.arc(x, y, width * 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function arc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number, color: string, w: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x, y, r, deg(a0 - 90), deg(a1 - 90));
  ctx.stroke();
}

function tachometer(ctx: CanvasRenderingContext2D, sim: Sim) {
  const x = 850;
  const y = 600;
  const r = 70;
  bezel(ctx, x, y, r);
  const angle = (rpm: number) => -135 + (Math.min(3500, rpm) / 3500) * 270;
  arc(ctx, x, y, r - 9, angle(2100), angle(2700), '#2fb34a', 8);
  arc(ctx, x, y, r - 9, angle(2700), angle(2730), '#e0362c', 8);
  for (let v = 0; v <= 35; v++) {
    const a = deg(angle(v * 100) - 90);
    const major = v % 5 === 0;
    ctx.strokeStyle = '#f4f2ea';
    ctx.lineWidth = major ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
    ctx.lineTo(x + Math.cos(a) * (r - (major ? 16 : 10)), y + Math.sin(a) * (r - (major ? 16 : 10)));
    ctx.stroke();
    if (major) label(ctx, String(v), x + Math.cos(a) * (r - 28), y + Math.sin(a) * (r - 28), 15);
  }
  label(ctx, 'RPM', x, y + 26, 12);
  label(ctx, 'x100', x, y + 40, 10, '#b9b6ac');
  needle(ctx, x, y, r - 12, angle(sim.flight.rpm), 5);
}

function engineCluster(ctx: CanvasRenderingContext2D, sim: Sim) {
  const x = 950;
  const y = 520;
  const w = 220;
  const h = 170;
  ctx.fillStyle = '#0c0d0e';
  ctx.strokeStyle = '#55595e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  const running = sim.flight.engine === 'running';
  const bars: [string, number][] = [
    ['FUEL L', sim.controls.master ? 0.8 : 0],
    ['FUEL R', sim.controls.master ? 0.78 : 0],
    ['OIL TEMP', running ? Math.min(0.55, 0.2 + sim.flight.t / 600) : 0.12],
    ['OIL PRESS', running ? 0.55 + (sim.flight.rpm / 2700) * 0.2 : 0],
  ];
  bars.forEach(([name, value], i) => {
    const by = y + 22 + i * 38;
    label(ctx, name, x + 50, by, 11);
    ctx.fillStyle = '#1d1f22';
    ctx.fillRect(x + 92, by - 6, 112, 12);
    ctx.fillStyle = '#2fb34a';
    ctx.fillRect(x + 120, by - 6, 60, 12);
    ctx.fillStyle = '#f4f2ea';
    ctx.fillRect(x + 92 + value * 112 - 2, by - 10, 4, 20);
  });
}

function annunciators(ctx: CanvasRenderingContext2D, sim: Sim) {
  const lights: [string, boolean, string][] = [
    ['LOW VOLTS', sim.controls.master && sim.flight.engine !== 'running', '#ffb020'],
    ['OIL PRESS', sim.controls.master && sim.flight.engine !== 'running', '#ff3b30'],
    ['STALL', sim.controls.master && sim.flight.stall, '#ff3b30'],
  ];
  lights.forEach(([name, on, color], i) => {
    const x = 950 + i * 76;
    const y = 470;
    ctx.fillStyle = on ? color : '#1a1b1d';
    ctx.strokeStyle = '#55595e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, 68, 30, 4);
    ctx.fill();
    ctx.stroke();
    if (on) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    label(ctx, name, x + 34, y + 15, 11, on ? '#1a0d00' : '#5b5e62');
  });
}

// ── switches, key, knobs, levers ───────────────────────────────────────────

function rocker(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean, color: string, name: string, w = 30, h = 54) {
  ctx.fillStyle = '#111214';
  ctx.beginPath();
  ctx.roundRect(x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8, 5);
  ctx.fill();
  // The pressed half sits low (dark); the raised half catches the light.
  const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  if (on) {
    g.addColorStop(0, color);
    g.addColorStop(0.5, color);
    g.addColorStop(1, '#00000088');
  } else {
    g.addColorStop(0, '#00000088');
    g.addColorStop(0.5, color);
    g.addColorStop(1, color);
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 6, on ? y - h / 2 + 6 : y + h / 2 - 10, 12, 4);
  label(ctx, name, x, y + h / 2 + 16, 12);
  label(ctx, on ? 'ON' : 'OFF', x, y - h / 2 - 14, 10, on ? '#ffffff' : '#7d8086');
}

function ignitionKey(ctx: CanvasRenderingContext2D, sim: Sim) {
  const x = 120;
  const y = 560;
  const positions: [string, number][] = [
    ['OFF', -75],
    ['R', -40],
    ['L', -10],
    ['BOTH', 25],
    ['START', 65],
  ];
  label(ctx, 'MAGNETOS', x, y - 74, 12);
  for (const [name, a] of positions) {
    const r = 58;
    label(ctx, name, x + Math.sin(deg(a)) * r, y - Math.cos(deg(a)) * r, name === 'START' ? 13 : 12, name === 'START' ? '#ff6b5b' : '#e9e6dc');
  }
  bezel(ctx, x, y, 34);
  const current = sim.controls.magnetos === 'start' ? 65 : sim.controls.magnetos === 'both' ? 25 : -75;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(deg(current));
  const g = ctx.createLinearGradient(-8, 0, 8, 0);
  g.addColorStop(0, '#8d9196');
  g.addColorStop(0.5, '#e3e6ea');
  g.addColorStop(1, '#7a7e83');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(-9, -30, 18, 60, 6);
  ctx.fill();
  ctx.fillStyle = '#2a2c2f';
  ctx.beginPath();
  ctx.arc(0, -20, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A push-pull plunger (throttle, mixture, carb heat): `out` 0 = pushed in … 1 = pulled out. */
function plunger(ctx: CanvasRenderingContext2D, x: number, y: number, out: number, kind: 'throttle' | 'mixture' | 'carb', name: string) {
  label(ctx, name, x, y - 52, 12);
  ctx.fillStyle = '#121315';
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fill();
  // Pulled out = closer to the eye: the knob sits lower and bigger, with the chrome shaft showing.
  const dy = out * 56;
  const scale = 1 + out * 0.3;
  if (out > 0.02) {
    const shaft = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
    shaft.addColorStop(0, '#6f7378');
    shaft.addColorStop(0.5, '#eef0f2');
    shaft.addColorStop(1, '#6f7378');
    ctx.fillStyle = shaft;
    ctx.fillRect(x - 6, y, 12, dy);
  }
  const r = 26 * scale;
  const ky = y + dy;
  const base = kind === 'throttle' ? '#1b1c1e' : kind === 'mixture' ? '#c8261e' : '#ece9e0';
  const g = ctx.createRadialGradient(x - r * 0.3, ky - r * 0.35, r * 0.1, x, ky, r);
  g.addColorStop(0, kind === 'carb' ? '#ffffff' : kind === 'mixture' ? '#ff6a5c' : '#5a5d61');
  g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, ky, r, 0, Math.PI * 2);
  ctx.fill();
  if (kind === 'mixture') {
    ctx.strokeStyle = '#7d120d';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.55, ky + Math.sin(a) * r * 0.55);
      ctx.lineTo(x + Math.cos(a) * r * 0.95, ky + Math.sin(a) * r * 0.95);
      ctx.stroke();
    }
  }
  // No words on the knobs: a state word ("RICH") on a pulled-out knob would mislead the VLM.
}

function parkingBrake(ctx: CanvasRenderingContext2D, sim: Sim) {
  const x = 120;
  const y = 860;
  const set = sim.controls.parkingBrake;
  label(ctx, 'PARK BRAKE', x, y - 50, 12);
  ctx.fillStyle = '#121315';
  ctx.beginPath();
  ctx.arc(x, y - 20, 12, 0, Math.PI * 2);
  ctx.fill();
  const dy = set ? 50 : 0;
  if (set) {
    ctx.fillStyle = '#c9ccd0';
    ctx.fillRect(x - 5, y - 20, 10, dy);
  }
  const hy = y - 20 + dy;
  ctx.fillStyle = '#d7d4ca';
  ctx.beginPath();
  ctx.roundRect(x - 40, hy - 10, 80, 20, 8);
  ctx.fill();
  if (set) {
    ctx.fillStyle = '#e0362c';
    ctx.beginPath();
    ctx.roundRect(x - 26, hy + 14, 52, 22, 4);
    ctx.fill();
    label(ctx, 'SET', x, hy + 25, 14, '#ffffff');
  }
}

function flaps(ctx: CanvasRenderingContext2D, sim: Sim) {
  const x = 1060;
  const top = 750;
  const step = 52;
  label(ctx, 'FLAPS', x, top - 30, 13);
  ctx.fillStyle = '#0c0d0e';
  ctx.beginPath();
  ctx.roundRect(x - 9, top - 8, 18, step * 3 + 16, 8);
  ctx.fill();
  [0, 10, 20, 30].forEach((d, i) => {
    label(ctx, `${d}°`, x - 44, top + i * step, 15);
    ctx.strokeStyle = '#e9e6dc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 26, top + i * step);
    ctx.lineTo(x - 14, top + i * step);
    ctx.stroke();
  });
  const ly = top + (sim.controls.flaps / 10) * step;
  const g = ctx.createLinearGradient(0, ly - 14, 0, ly + 14);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#b8b5ab');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x - 30, ly - 13, 60, 26, 6);
  ctx.fill();
  ctx.fillStyle = '#5b5e62';
  ctx.fillRect(x - 22, ly - 2, 44, 4);
  // Flap position indicator (actual flaps, which lag the lever).
  const ix = x + 62;
  ctx.fillStyle = '#0c0d0e';
  ctx.fillRect(ix - 10, top - 8, 20, step * 3 + 16);
  const iy = top + (sim.flight.flapsDeg / 10) * step;
  ctx.fillStyle = '#ffb020';
  ctx.beginPath();
  ctx.moveTo(ix - 8, iy);
  ctx.lineTo(ix + 8, iy - 7);
  ctx.lineTo(ix + 8, iy + 7);
  ctx.fill();
}

function fuelSelector(ctx: CanvasRenderingContext2D, sim: Sim) {
  const x = 1218;
  const y = 860;
  const r = 44;
  label(ctx, 'FUEL', x, y - r - 26, 13);
  ctx.fillStyle = '#d9d5c8';
  ctx.beginPath();
  ctx.arc(x, y, r + 12, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, 'BOTH', x, y - r + 2, 12, '#1a1b1d');
  label(ctx, 'OFF', x, y + r - 4, 12, '#c8261e');
  ctx.fillStyle = '#25272a';
  ctx.beginPath();
  ctx.arc(x, y, r - 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sim.controls.fuelBoth ? 0 : Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -r + 10);
  ctx.lineTo(9, -6);
  ctx.lineTo(5, 20);
  ctx.lineTo(-5, 20);
  ctx.lineTo(-9, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── windshield furniture ───────────────────────────────────────────────────

function windshieldFrame(ctx: CanvasRenderingContext2D, sim: Sim, w: number) {
  // Cowling top and the propeller.
  const cx = w / 2;
  const f = sim.flight;
  ctx.save();
  ctx.translate(0, 0);
  const cowl = ctx.createLinearGradient(0, 330, 0, PANEL_TOP);
  cowl.addColorStop(0, '#e6e3da');
  cowl.addColorStop(1, '#9c998f');
  ctx.fillStyle = cowl;
  ctx.beginPath();
  ctx.moveTo(cx - 420, PANEL_TOP);
  ctx.quadraticCurveTo(cx, 330, cx + 420, PANEL_TOP);
  ctx.fill();
  const hubY = 352;
  if (f.rpm > 0) {
    if (f.rpm < 500) {
      ctx.save();
      ctx.translate(cx, hubY);
      ctx.rotate(deg(f.propDeg));
      ctx.fillStyle = '#141414';
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.ellipse(0, s * 150, 13, 150, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      const g = ctx.createRadialGradient(cx, hubY, 10, cx, hubY, 300);
      g.addColorStop(0, 'rgba(20,20,20,0.10)');
      g.addColorStop(0.9, 'rgba(20,20,20,0.16)');
      g.addColorStop(1, 'rgba(20,20,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, hubY, 300, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, hubY, 296, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.save();
    ctx.translate(cx, hubY);
    ctx.rotate(deg(38));
    ctx.fillStyle = '#141414';
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.ellipse(0, s * 150, 13, 150, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  const spinner = ctx.createRadialGradient(cx - 6, hubY - 6, 2, cx, hubY, 22);
  spinner.addColorStop(0, '#ffffff');
  spinner.addColorStop(1, '#8d8a80');
  ctx.fillStyle = spinner;
  ctx.beginPath();
  ctx.arc(cx, hubY, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Frame: roof and A-pillars.
  ctx.fillStyle = '#1b1c1f';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, 40);
  ctx.quadraticCurveTo(w / 2, 10, 0, 40);
  ctx.closePath();
  ctx.fill();
  for (const side of [0, 1]) {
    ctx.beginPath();
    const x0 = side ? w : 0;
    const dir = side ? -1 : 1;
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + dir * 70, 0);
    ctx.lineTo(x0 + dir * 26, PANEL_TOP);
    ctx.lineTo(x0, PANEL_TOP);
    ctx.closePath();
    ctx.fill();
  }
  // Compass on the windshield post.
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.roundRect(w / 2 - 34, 40, 68, 36, 8);
  ctx.fill();
  label(ctx, '35', w / 2, 58, 18, '#f4f2ea');
}

/** Draw the windshield furniture and the panel over the already-drawn outside view. */
export function drawPanel(ctx: CanvasRenderingContext2D, im: PanelImages, sim: Sim, w: number, h: number) {
  windshieldFrame(ctx, sim, w);
  // Glare shield.
  ctx.fillStyle = '#121315';
  ctx.beginPath();
  ctx.moveTo(0, PANEL_TOP - 14);
  ctx.quadraticCurveTo(w / 2, PANEL_TOP - 34, w, PANEL_TOP - 14);
  ctx.lineTo(w, PANEL_TOP + 22);
  ctx.lineTo(0, PANEL_TOP + 22);
  ctx.closePath();
  ctx.fill();
  ctx.drawImage(panelFace(w, h - PANEL_TOP - 22), 0, PANEL_TOP + 22);
  for (const [sx, sy] of [
    [30, 470],
    [w - 30, 470],
    [30, h - 30],
    [w - 30, h - 30],
    [560, h - 30],
    [760, 470],
  ] as const)
    screw(ctx, sx, sy);

  sixPack(ctx, im, sim);
  tachometer(ctx, sim);
  engineCluster(ctx, sim);
  annunciators(ctx, sim);
  ignitionKey(ctx, sim);
  rocker(ctx, 92, 720, sim.controls.master, '#c8261e', 'BAT');
  rocker(ctx, 140, 720, sim.controls.master, '#c8261e', 'ALT');
  label(ctx, 'MASTER', 116, 670, 12);
  const lightRow: [string, boolean][] = [
    ['BCN', false],
    ['LAND', sim.controls.landingLight],
    ['TAXI', false],
    ['NAV', false],
    ['STROBE', false],
  ];
  lightRow.forEach(([name, on], i) => rocker(ctx, 260 + i * 62, 860, on, '#26282b', name, 28, 46));
  plunger(ctx, 640, 860, 0, 'carb', 'CARB HEAT');
  plunger(ctx, 770, 860, 1 - sim.controls.throttle, 'throttle', 'THROTTLE');
  plunger(ctx, 900, 860, sim.controls.mixtureRich ? 0 : 1, 'mixture', 'MIXTURE');
  parkingBrake(ctx, sim);
  flaps(ctx, sim);
  fuelSelector(ctx, sim);
}

/**
 * Nodal solver with piecewise-linear iteration.
 *
 * All devices are conductances + Norton sources (see models/types.ts), so the
 * system is G·V = I over the non-reference nodes. Each connected component has
 * its own 0 V reference (board GND › battery minus › first node) and every node
 * gets G_MIN to its reference so floating parts stay well defined.
 */
import { luSolve } from './linalg';
import { G_MIN, G_OFF, type DiodeDevice, type Device, type NpnDevice, type NpnState, type Term } from './models';
import { UnionFind } from './unionfind';

export const MAX_ITERATIONS = 60;
/** After this many iterations only the most-violating device flips (anti-oscillation). */
const FLIP_ALL_UNTIL = 25;
const V_EPS = 1e-9;
const I_EPS = 1e-12;

export interface NetworkSolution {
  /** Node voltages (relative to each component reference). */
  v: Float64Array;
  converged: boolean;
  iterations: number;
}

export function terminals(d: Device): Term[] {
  switch (d.kind) {
    case 'res':
      return [d.a, d.b];
    case 'vsrc':
      return [d.p, d.n];
    case 'diode':
      return [d.a, d.c];
    case 'npn':
      return [d.c, d.b, d.e];
  }
}

const isStructural = (d: Device) => d.kind !== 'res' || d.structural;

/** One reference node per connected component (connections through open switches ignored). */
export function chooseReferences(nodeCount: number, devices: Device[], priority: number[]): Uint8Array {
  const uf = new UnionFind(nodeCount);
  const used = new Uint8Array(nodeCount);
  for (const d of devices) {
    const ts = terminals(d);
    for (const t of ts) used[t.node] = 1;
    if (!isStructural(d)) continue;
    for (let k = 1; k < ts.length; k++) uf.union(ts[0].node, ts[k].node);
  }
  const refOfRoot = new Map<number, number>();
  for (const node of priority) {
    if (!used[node]) continue;
    const r = uf.find(node);
    if (!refOfRoot.has(r)) refOfRoot.set(r, node);
  }
  for (let node = 0; node < nodeCount; node++) {
    if (!used[node]) continue;
    const r = uf.find(node);
    if (!refOfRoot.has(r)) refOfRoot.set(r, node);
  }
  const refs = new Uint8Array(nodeCount);
  for (const node of refOfRoot.values()) refs[node] = 1;
  return refs;
}

class Assembler {
  constructor(
    readonly n: number,
    readonly rowOf: Int32Array,
    readonly G: Float64Array,
    readonly I: Float64Array,
  ) {}

  g(a: number, b: number, g: number) {
    const ra = this.rowOf[a];
    const rb = this.rowOf[b];
    const { G, n } = this;
    if (ra >= 0) G[ra * n + ra] += g;
    if (rb >= 0) G[rb * n + rb] += g;
    if (ra >= 0 && rb >= 0) {
      G[ra * n + rb] -= g;
      G[rb * n + ra] -= g;
    }
  }

  /** Inject current i INTO node a. */
  i(a: number, i: number) {
    const r = this.rowOf[a];
    if (r >= 0) this.I[r] += i;
  }

  /** Source `volts` (+ at p) with series `ohms` (Norton form). */
  src(p: number, nn: number, volts: number, ohms: number) {
    const g = 1 / ohms;
    this.g(p, nn, g);
    this.i(p, volts * g);
    this.i(nn, -volts * g);
  }

  /** Current gm·(V(cp) − V(cn)) flowing out of node op, through the device, into node on. */
  vccs(op: number, on: number, cp: number, cn: number, gm: number) {
    const { G, n, rowOf } = this;
    const rop = rowOf[op];
    const ron = rowOf[on];
    const rcp = rowOf[cp];
    const rcn = rowOf[cn];
    if (rop >= 0) {
      if (rcp >= 0) G[rop * n + rcp] += gm;
      if (rcn >= 0) G[rop * n + rcn] -= gm;
    }
    if (ron >= 0) {
      if (rcp >= 0) G[ron * n + rcp] -= gm;
      if (rcn >= 0) G[ron * n + rcn] += gm;
    }
  }

  stamp(d: Device) {
    switch (d.kind) {
      case 'res':
        this.g(d.a.node, d.b.node, 1 / d.ohms);
        return;
      case 'vsrc':
        this.src(d.p.node, d.n.node, d.volts, d.ohms);
        return;
      case 'diode':
        if (d.on) this.src(d.a.node, d.c.node, d.vf, d.ron);
        else this.g(d.a.node, d.c.node, G_OFF);
        return;
      case 'npn': {
        const c = d.c.node;
        const b = d.b.node;
        const e = d.e.node;
        if (d.state === 'off') {
          this.g(b, e, G_OFF);
          this.g(c, e, G_OFF);
          return;
        }
        this.src(b, e, d.vbe, d.rbe);
        if (d.state === 'active') {
          const gm = d.beta / d.rbe;
          this.vccs(c, e, b, e, gm);
          this.i(c, gm * d.vbe);
          this.i(e, -gm * d.vbe);
          this.g(c, e, G_OFF);
        } else {
          this.src(c, e, d.vceSat, d.rsat);
        }
      }
    }
  }
}

function diodeWant(d: DiodeDevice, v: Float64Array): { on: boolean; viol: number } {
  const vd = v[d.a.node] - v[d.c.node];
  if (d.on) return vd < d.vf - V_EPS ? { on: false, viol: d.vf - vd } : { on: true, viol: 0 };
  return vd > d.vf + V_EPS ? { on: true, viol: vd - d.vf } : { on: false, viol: 0 };
}

function npnWant(d: NpnDevice, v: Float64Array): { state: NpnState; viol: number } {
  const vbe = v[d.b.node] - v[d.e.node];
  const vce = v[d.c.node] - v[d.e.node];
  if (d.state === 'off') return vbe > d.vbe + V_EPS ? { state: 'active', viol: vbe - d.vbe } : { state: 'off', viol: 0 };
  const ib = (vbe - d.vbe) / d.rbe;
  if (ib < -I_EPS) return { state: 'off', viol: -ib * d.rbe };
  if (d.state === 'active') {
    return vce < d.vceSat - V_EPS ? { state: 'sat', viol: d.vceSat - vce } : { state: 'active', viol: 0 };
  }
  const ic = (vce - d.vceSat) / d.rsat;
  if (ic > d.beta * ib + I_EPS) return { state: 'active', viol: (ic - d.beta * ib) * d.rsat };
  return { state: 'sat', viol: 0 };
}

/** Solve the network; device states (diode.on / npn.state) are updated IN PLACE. */
export function solveNetwork(nodeCount: number, devices: Device[], refs: Uint8Array): NetworkSolution {
  const rowOf = new Int32Array(nodeCount).fill(-1);
  let n = 0;
  for (const d of devices) {
    for (const t of terminals(d)) {
      if (!refs[t.node] && rowOf[t.node] < 0) rowOf[t.node] = n++;
    }
  }
  const v = new Float64Array(nodeCount);
  if (n === 0) return { v, converged: true, iterations: 1 };

  const G = new Float64Array(n * n);
  const I = new Float64Array(n);
  const asm = new Assembler(n, rowOf, G, I);
  const pwl = devices.filter((d): d is DiodeDevice | NpnDevice => d.kind === 'diode' || d.kind === 'npn');
  let converged = false;
  let iterations = 0;

  for (let it = 1; it <= MAX_ITERATIONS; it++) {
    iterations = it;
    G.fill(0);
    I.fill(0);
    for (let r = 0; r < n; r++) G[r * n + r] = G_MIN;
    for (const d of devices) asm.stamp(d);
    const x = luSolve(G, I, n);
    if (!x) break;
    for (let node = 0; node < nodeCount; node++) v[node] = rowOf[node] >= 0 ? x[rowOf[node]] : 0;

    let changes = 0;
    let worst: { d: DiodeDevice | NpnDevice; on?: boolean; state?: NpnState } | null = null;
    let worstViol = -1;
    const pending: Array<() => void> = [];
    for (const d of pwl) {
      if (d.kind === 'diode') {
        const w = diodeWant(d, v);
        if (w.on === d.on) continue;
        changes++;
        pending.push(() => (d.on = w.on));
        if (w.viol > worstViol) {
          worstViol = w.viol;
          worst = { d, on: w.on };
        }
      } else {
        const w = npnWant(d, v);
        if (w.state === d.state) continue;
        changes++;
        pending.push(() => (d.state = w.state));
        if (w.viol > worstViol) {
          worstViol = w.viol;
          worst = { d, state: w.state };
        }
      }
    }
    if (changes === 0) {
      converged = true;
      break;
    }
    if (it < FLIP_ALL_UNTIL) for (const apply of pending) apply();
    else if (worst) {
      if (worst.d.kind === 'diode') worst.d.on = !!worst.on;
      else worst.d.state = worst.state ?? 'off';
    }
  }
  return { v, converged, iterations };
}

/* ---------------------------------------------------------------- currents */

export const resCurrent = (d: { a: Term; b: Term; ohms: number }, v: Float64Array) => (v[d.a.node] - v[d.b.node]) / d.ohms;

/** Current p → n THROUGH the source (negative while it delivers power). */
export const srcCurrent = (d: { p: Term; n: Term; volts: number; ohms: number }, v: Float64Array) =>
  (v[d.p.node] - v[d.n.node] - d.volts) / d.ohms;

export function diodeCurrent(d: DiodeDevice, v: Float64Array): number {
  const vd = v[d.a.node] - v[d.c.node];
  return d.on ? (vd - d.vf) / d.ron : vd * G_OFF;
}

export function npnCurrents(d: NpnDevice, v: Float64Array): { ib: number; ic: number; ie: number } {
  const vbe = v[d.b.node] - v[d.e.node];
  const vce = v[d.c.node] - v[d.e.node];
  let ib: number;
  let ic: number;
  if (d.state === 'off') {
    ib = vbe * G_OFF;
    ic = vce * G_OFF;
  } else {
    ib = (vbe - d.vbe) / d.rbe;
    ic = d.state === 'active' ? d.beta * ib + vce * G_OFF : (vce - d.vceSat) / d.rsat;
  }
  return { ib, ic, ie: ib + ic };
}

/** Current flowing from each terminal's node INTO the device. */
export function terminalCurrents(d: Device, v: Float64Array): Array<[Term, number]> {
  switch (d.kind) {
    case 'res': {
      const i = resCurrent(d, v);
      return [
        [d.a, i],
        [d.b, -i],
      ];
    }
    case 'vsrc': {
      const i = srcCurrent(d, v);
      return [
        [d.p, i],
        [d.n, -i],
      ];
    }
    case 'diode': {
      const i = diodeCurrent(d, v);
      return [
        [d.a, i],
        [d.c, -i],
      ];
    }
    case 'npn': {
      const { ib, ic, ie } = npnCurrents(d, v);
      return [
        [d.c, ic],
        [d.b, ib],
        [d.e, -ie],
      ];
    }
  }
}

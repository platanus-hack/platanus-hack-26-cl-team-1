// The C172 cockpit simulator (owner: Anaís): flight model + windshield (three.js) + panel, composited
// into one 1280×960 canvas, driven by the keyboard.
import type { SimEvent, Simulator } from '../types';
import { CockpitAudio } from './audio';
import { attachKeyboard, LEGEND } from './keys';
import { apply, initialSim, type Inputs, type Sim, step } from './model';
import { OutsideView } from './outside';
import { drawPanel, loadPanelImages, PANEL_TOP, type PanelImages } from './panel';

export const WIDTH = 1280;
export const HEIGHT = 960;
const PHYSICS_DT = 1 / 120;

export class C172Cockpit implements Simulator {
  readonly canvas: HTMLCanvasElement;
  readonly legend = LEGEND;
  private ctx: CanvasRenderingContext2D;
  private outside: OutsideView | null = null;
  private images: PanelImages | null = null;
  private audio = new CockpitAudio();
  private sim: Sim = initialSim();
  private inputs: Inputs = { throttleIn: false, throttleOut: false, pitchUp: false, pitchDown: false, starter: false };
  private frame = 0;
  private last = 0;
  private acc = 0;
  private detachKeys: (() => void) | null = null;
  private onEvent: (event: SimEvent) => void = () => {};
  private log: SimEvent[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    // Dev builds only: frame-capture tooling (sim/cockpit/) waits on real conditions (airspeed, airborne).
    if (import.meta.env.DEV) (window as unknown as { __c172?: C172Cockpit }).__c172 = this;
  }

  /** Current state (read-only use: debugging and capture tooling). */
  get state(): Sim {
    return this.sim;
  }

  /** Every event since `start()`, on simulator time (read-only use: capture and dataset tooling). */
  get eventLog(): readonly SimEvent[] {
    return this.log;
  }

  async load(): Promise<void> {
    this.images ??= await loadPanelImages();
    this.outside ??= new OutsideView(WIDTH, PANEL_TOP + 20);
    this.draw(); // a first still frame
  }

  start(onEvent: (event: SimEvent) => void): void {
    this.stop();
    this.log = [];
    this.onEvent = (event) => {
      this.log.push(event);
      onEvent(event);
    };
    this.sim = initialSim();
    for (const key of Object.keys(this.inputs) as (keyof Inputs)[]) this.inputs[key] = false;
    this.audio.start();
    this.detachKeys = attachKeyboard(
      window,
      (command) => {
        const r = apply(this.sim.controls, command);
        this.sim = { ...this.sim, controls: r.controls };
        if (r.action) this.onEvent({ t: this.sim.flight.t, action: r.action });
      },
      this.inputs,
    );
    this.last = performance.now();
    this.acc = 0;
    const loop = (now: number) => {
      this.acc += Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      while (this.acc >= PHYSICS_DT) {
        const r = step(this.sim, this.inputs, PHYSICS_DT);
        this.sim = r.sim;
        for (const action of r.events) this.onEvent({ t: this.sim.flight.t, action });
        this.acc -= PHYSICS_DT;
      }
      this.audio.update(this.sim);
      this.draw();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.detachKeys?.();
    this.detachKeys = null;
    this.audio.stop();
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  dispose(): void {
    this.stop();
    this.outside?.dispose();
  }

  private draw() {
    if (!this.outside || !this.images) return;
    this.outside.render(this.sim);
    this.ctx.drawImage(this.outside.canvas, 0, 0, WIDTH, PANEL_TOP + 20);
    drawPanel(this.ctx, this.images, this.sim, WIDTH, HEIGHT);
  }
}

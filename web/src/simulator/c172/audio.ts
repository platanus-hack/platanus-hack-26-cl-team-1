// Engine drone and stall horn with WebAudio (owner: Anaís). Started from a click (autoplay rules).
import type { Sim } from './model';

export class CockpitAudio {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private hornGain: GainNode | null = null;
  muted = false;

  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);

    // Engine: a filtered sawtooth at the firing frequency of a 4-cylinder (rpm/60 × 2).
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.connect(filter).connect(this.engineGain).connect(master);
    this.engineOsc.start();

    // Propeller wash: low-passed noise.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 700;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(this.noiseGain).connect(master);
    noise.start();

    // Stall horn: a reedy tone.
    const horn = ctx.createOscillator();
    horn.type = 'square';
    horn.frequency.value = 520;
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    horn.connect(this.hornGain).connect(master);
    horn.start();
  }

  update(sim: Sim): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.noiseGain || !this.hornGain) return;
    const t = this.ctx.currentTime;
    const rpm = sim.flight.rpm;
    const on = !this.muted;
    this.engineOsc.frequency.setTargetAtTime(Math.max(20, (rpm / 60) * 2), t, 0.05);
    this.engineGain.gain.setTargetAtTime(on ? Math.min(0.5, rpm / 4000) : 0, t, 0.08);
    this.noiseGain.gain.setTargetAtTime(on ? Math.min(0.25, rpm / 9000 + sim.flight.airspeedKt / 600) : 0, t, 0.1);
    this.hornGain.gain.setTargetAtTime(on && sim.flight.stall && sim.controls.master ? 0.08 : 0, t, 0.03);
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.engineOsc = this.engineGain = this.noiseGain = this.hornGain = null;
  }
}

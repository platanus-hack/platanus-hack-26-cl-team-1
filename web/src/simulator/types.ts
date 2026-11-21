// What a project's simulator gives the Simulator page (owner: Anaís). One per task id (registry.ts).

/** A ground-truth action the simulator saw the person do, at `t` seconds of simulator time since `start()`.
 * Simulator time stops while the tab is hidden; anything aligned with a video re-stamps on the video's clock. */
export type SimEvent = { t: number; action: string };

export interface Simulator {
  /** The rendered view. It is the "camera": practice streams it, recording records it. */
  readonly canvas: HTMLCanvasElement;
  /** Key legend shown next to the view (Spanish). */
  readonly legend: { keys: string; label: string }[];
  /** Load assets; must resolve before `start`. */
  load(): Promise<void>;
  /** Reset to the initial state and run (render loop + keyboard). Call from a click (starts audio). */
  start(onEvent: (event: SimEvent) => void): void;
  stop(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

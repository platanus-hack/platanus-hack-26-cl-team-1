// Decides, per capture tick, whether the camera gave a new frame (owner: Anaís). A stalled camera keeps
// its last frame on screen; resending it would look live to the server, so ticks without a new frame
// are skipped, and no new frame for `stallMs` is reported as a stall.

export type GateResult = 'capture' | 'skip' | 'stalled';

export class FrameGate {
  private fresh = false;
  private lastFrameAt: number;

  constructor(
    private readonly stallMs: number,
    startedAt: number,
  ) {
    this.lastFrameAt = startedAt;
  }

  markFrame(now: number): void {
    this.fresh = true;
    this.lastFrameAt = now;
  }

  /** The page is hidden, so the browser reports no frames: don't count that time toward a stall. */
  hold(now: number): void {
    this.lastFrameAt = now;
  }

  take(now: number): GateResult {
    if (this.fresh) {
      this.fresh = false;
      return 'capture';
    }
    return now - this.lastFrameAt >= this.stallMs ? 'stalled' : 'skip';
  }
}

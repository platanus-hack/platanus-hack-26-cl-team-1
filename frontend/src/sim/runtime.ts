/**
 * WORKSTREAM B — simulation runtime (owned by the sim agent).
 * Orchestrates: project/runtime changes → solve (always live), program
 * execution (interpreter ↔ solver), LED burnout, buzzer audio, sim store.
 *
 * Internals: live.ts (controller), headless.ts/headlessCore.ts (runHeadless),
 * drives.ts + host.ts (InterpreterHost), serial.ts, health.ts, timeline.ts, audio.ts.
 */
import type { Id } from '@/contracts';
import { live } from './live';

export const simRuntime = {
  /** Start live electrical simulation (called once by the app shell). Idempotent. */
  init(): void {
    live.init();
  },
  /** ▶ Run the block program (resumes when paused). */
  startProgram(): void {
    live.startProgram();
  },
  pauseProgram(): void {
    live.pauseProgram();
  },
  /** Stop: every pin back to high-Z input, tones off, servos released, clock to 0. */
  stopProgram(): void {
    live.stopProgram();
  },
  /** Restart program + clear serial + repair burned parts + clear runtime props. */
  reset(): void {
    live.reset();
  },
};

/** Headless run for the agent's `simulate` tool and tests (does not touch the live store). */
export { runHeadless } from './headless';

/** Servo angles commanded by the running program (useSim has no field for them yet). */
export const getServoAngles = (): Record<Id, number> => live.servoAngles;

/* Audio preferences (global mute, persisted). */
export { isMuted, setMuted, useMuted, unlockAudio } from './audio';

/* Formatting helpers used by the sim panel. */
export { formatClock, formatStamp } from './clock';

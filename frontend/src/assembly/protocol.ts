/**
 * Modo Armado — WebSocket protocol with the vision server (`/ws/session`).
 * Mirrored in vision/vision/protocol.py. Bump PROTOCOL on breaking changes.
 *
 * Binary messages:
 *  - client → server, one per frame: 8-byte little-endian header
 *    (uint32 seq, uint32 t_ms) followed by a JPEG.
 *  - server → client, one per `say`: uint8 idLen, the id (ASCII), then a WAV.
 */
import type { GuideStep, Netlist, PartDef, ProjectModel } from '@/contracts';

export const PROTOCOL = 1;

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export type IssueKind = 'missing' | 'wrong_hole' | 'led_reversed' | 'wrong_part' | 'wire_wrong_end' | 'extra_part';

export interface HelloMsg {
  type: 'hello';
  protocol: number;
  project: ProjectModel;
  netlist: Netlist;
  steps: GuideStep[];
  /** Only the part types used by the project. */
  parts: Record<string, PartDef>;
  /** true = dataset recording session (labels via `label`). */
  record: boolean;
  /** Ask the server for `debug` payloads with detections (ack-only otherwise). */
  debug: boolean;
  /** On reconnect: resume from this step with these statuses. */
  resume?: { current: number; status: Record<string, StepStatus> };
}

export type ClientMsg =
  | HelloMsg
  | { type: 'label'; kind: 'error_inserted'; error: IssueKind; target?: string }
  | { type: 'label'; kind: 'error_fixed' }
  | { type: 'skip_step' }
  | { type: 'back_step' }
  | { type: 'set_debug'; debug: boolean }
  | { type: 'set_record'; record: boolean }
  | { type: 'set_capture'; on: boolean }
  /** Click calibration: image pixel (in the 640×480 frame) of the corner holes a1, a30, j1, j30. */
  | { type: 'calib_points'; points: Record<string, [number, number]> }
  | { type: 'mute'; muted: boolean };

export interface Detection {
  cls: string;
  conf: number;
  box: [number, number, number, number]; // x1 y1 x2 y2, frame pixels
  /** Holes the legs of this detection map to (when calibrated). */
  holes?: string[];
  /** wire_end only: jumper colour read in HSV ('red', 'black', …). */
  color?: string;
}

export type ServerMsg =
  | { type: 'ready'; calibrated: boolean; session: string; voice: string | null }
  /** H maps breadboard grid units (catalog/breadboard.ts) → frame pixels, row-major 3×3. */
  | { type: 'calibration'; ok: boolean; markers: number; H?: number[]; refined?: boolean; message?: string }
  | { type: 'step'; current: number; status: Record<string, StepStatus> }
  | { type: 'issue'; step: number; kind: IssueKind; target?: string; text: string; holes?: string[] }
  | { type: 'issue_clear'; step: number }
  | { type: 'say'; id: string; text: string; priority: 'error' | 'info'; audio: boolean }
  | { type: 'cancel_say'; id: string }
  | {
      type: 'debug';
      seq: number;
      t_ms: number;
      detections?: Detection[];
      latency_ms: Record<string, number>;
      paused?: string;
    }
  | { type: 'capture'; saved: number }
  | { type: 'error'; message: string };

export function encodeFrame(seq: number, tMs: number, jpeg: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(8 + jpeg.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, seq >>> 0, true);
  dv.setUint32(4, tMs >>> 0, true);
  out.set(new Uint8Array(jpeg), 8);
  return out.buffer;
}

export function decodeAudio(buf: ArrayBuffer): { id: string; audio: ArrayBuffer } {
  const bytes = new Uint8Array(buf);
  const n = bytes[0];
  const id = String.fromCharCode(...bytes.subarray(1, 1 + n));
  return { id, audio: buf.slice(1 + n) };
}

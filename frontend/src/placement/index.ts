/**
 * WORKSTREAM A — automatic placement & wiring (owned by the schematic/guide agent).
 * Used by the agent tools and the examples. Returns OPS (the caller dispatches).
 *
 *  planAddPart    id/label/props + position; insertable parts go into free,
 *                 unused breadboard strips (holes listed in the result).
 *  planConnect    jumper wire; inserted legs / header pins are wired from a
 *                 free hole of their strip, busy holes (covered, holding a leg
 *                 or a wire end) are swapped for a free hole of the same strip;
 *                 off-board pins and free holes / rails are used as given.
 *  planDisconnect remove a wire by id or every wire between two pins.
 *  coveredHoles   holes under a non-breadboard part body (never "free").
 *  findFreeSpot   non-overlapping origin for a part in free space.
 */
import type { Id, PinRef, Point, ProjectModel, WireColor } from '@/contracts';
import type { PlanAddPartOptions, PlanAddPartResult, PlanConnectResult, PlanDisconnectResult } from './types';
import { planAddPart as planAddPartImpl } from './addPart';
import { planConnect as planConnectImpl, planDisconnect as planDisconnectImpl } from './connect';
import { findFreeSpot as findFreeSpotImpl } from './freeSpot';
import { buildOccupancy } from './space';

export type { PlanAddPartOptions, PlanAddPartResult, PlanConnectResult, PlanDisconnectResult } from './types';

export function planAddPart(project: ProjectModel, type: string, opts: PlanAddPartOptions = {}): PlanAddPartResult {
  return planAddPartImpl(project, type, opts);
}

export function planConnect(project: ProjectModel, from: PinRef, to: PinRef, color?: WireColor): PlanConnectResult {
  return planConnectImpl(project, from, to, color);
}

/**
 * Remove a wire by id, or every wire directly between two pins. A wire end
 * matches a pin when it IS that pin or is a hole of the breadboard strip that
 * pin is inserted into (planConnect may have rerouted it there). With both
 * ends given, a hole also matches any hole of its strip.
 */
export function planDisconnect(project: ProjectModel, q: { wireId?: Id; from?: PinRef; to?: PinRef }): PlanDisconnectResult {
  return planDisconnectImpl(project, q);
}

/**
 * Breadboard holes that are covered by the body of another non-breadboard part
 * (e.g. under an ESP32 devkit): not free for new legs or wire ends.
 */
export function coveredHoles(project: ProjectModel): Set<PinRef> {
  return buildOccupancy(project).covered;
}

/** Free top-left spot for a part of the given type (grid units). */
export function findFreeSpot(project: ProjectModel, type: string, near?: Id): Point {
  return findFreeSpotImpl(project, type, near);
}

/* Extra helpers (used by the guide, schematic and examples). */
export { netlistFor, computeNetlist } from './connectivity';
export { findBreadboardSpot, normalizeProps } from './addPart';
export { autoWireColor, netKindOf, freeHoleInStrip, SIGNAL_COLORS } from './connect';
export { buildOccupancy, breadboardsOf, breadboardModel, isHoleFree, holeUnderPin } from './space';
export type { HoleInfo, BreadboardModel, Occupancy, Rect } from './space';

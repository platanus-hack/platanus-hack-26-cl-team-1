// Tasks that only exist inside an in-page simulator (owner: Anaís): a camera can't film them (nobody has a
// Cessna on the table), so the camera supervisor page doesn't offer them. Kept apart from registry.ts so
// that page doesn't pull in three.js.
export const SIM_ONLY_TASKS: ReadonlySet<string> = new Set(['c172_takeoff']);

export function cameraTasks<T extends { id: string }>(tasks: T[]): T[] {
  return tasks.filter((t) => !SIM_ONLY_TASKS.has(t.id));
}

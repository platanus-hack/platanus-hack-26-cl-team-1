// What the explorer says when the fire reaches the edge of the simulated area (src/engine/fire/edge.ts).
import type { EdgeContact } from '../engine/fire/edge'
import { minToDateLabel, minToHHMM } from '../data/time'

const SIDES = [
  ['north', 'norte'],
  ['south', 'sur'],
  ['east', 'este'],
  ['west', 'oeste'],
] as const

/** Sides the fire reaches, earliest first, with the local time of the first contact on each. */
export function edgeSides(edge: EdgeContact, t0: string): { side: string; when: string }[] {
  return SIDES.filter(([k]) => Number.isFinite(edge[k]))
    .sort((a, b) => edge[a[0]] - edge[b[0]])
    .map(([k, es]) => ({ side: es, when: localTime(t0, edge[k]) }))
}

/** "21:21", or "08:42 del 8 ene 2025" when it falls on a later day than the start (e.g. Eaton's night). */
function localTime(t0: string, min: number): string {
  const day = minToDateLabel(t0, min)
  return day === minToDateLabel(t0, 0) ? minToHHMM(t0, min) : `${minToHHMM(t0, min)} del ${day}`
}

/** The map note, or null when the fire stays inside the simulated area. */
export function edgeNote(edge: EdgeContact, t0: string): string | null {
  const sides = edgeSides(edge, t0)
  if (sides.length === 0) return null
  const where =
    sides.length === 1
      ? `al borde ${sides[0].side} del área simulada a las ${sides[0].when}`
      : `a los bordes del área simulada: ${joinEs(sides.map((s) => `${s.side} a las ${s.when}`))}`
  return `El fuego llega ${where}. Más allá no hay datos y el modelo no lo sigue: las cifras no incluyen lo que alcanzaría al otro lado.`
}

/** The line under the final burned area, or null when the fire stays inside the simulated area. */
export function edgeStatNote(edge: EdgeContact, t0: string): string | null {
  if (!Number.isFinite(edge.firstMin)) return null
  return `Sin lo que quemaría fuera del área simulada: el fuego llega a su borde a las ${localTime(t0, edge.firstMin)}.`
}

function joinEs(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

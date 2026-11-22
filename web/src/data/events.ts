// The historical events the explorer can replay, one baked dataset each (pipeline/bake.py --event <id>).
// The event is chosen once per page load from ?evento=<id> (the picker reloads the page), so every module of a
// page sees one event; the worker gets the id in its init message. An unknown id is an error, not Viña.
import { ERA5_WIND_DIR_CORRECTION_DEG } from '../engine/fire/model'

export const EVENT_IDS = ['vina-2024', 'eaton-2025'] as const
export type EventId = (typeof EVENT_IDS)[number]
export const DEFAULT_EVENT: EventId = 'vina-2024'

/** A value shown or used by default, with where it comes from (null source = labelled assumption). */
export interface Sourced<T> {
  value: T
  source: string | null
}

export interface EventDef {
  id: EventId
  /** Picker label (Spanish). */
  label: string
  /** Header subtitle (Spanish). */
  subtitle: string
  /** Data folder under public/data/ ('' = the root: Viña's files stayed where they were). */
  dir: string
  /** Simulation horizon, minutes since GridMeta.t0. */
  horizonMin: number
  /** Correction added to the historical ERA5 wind direction (deg). Fitted on Viña's scar only; 0 elsewhere
   *  (no site fit: see engine/fire/MODEL.md). */
  windDirCorrectionDeg: number
  /** Optional layers this event ships: brigades.json, population_{home,work}.bin. */
  layers: { brigades: boolean; population: boolean }
  /** Evacuation defaults that depend on the place. */
  evac: {
    alertMin: Sourced<number>
    personsPerHousehold: Sourced<number>
    footShare: Sourced<number>
  }
  /** Calendar of the real date, for the population section (Spanish), or null. */
  calendarNote: string | null
}

export const EVENTS: Record<EventId, EventDef> = {
  'vina-2024': {
    id: 'vina-2024',
    label: 'Viña del Mar, Quilpué y Villa Alemana · 2 feb 2024',
    subtitle: 'Explorador de escenarios del incendio del 2 de febrero de 2024 · Viña del Mar, Quilpué y Villa Alemana',
    dir: '',
    horizonMin: 12 * 60, // 12:00 to midnight: the model has no suppression, so later hours overburn
    windDirCorrectionDeg: ERA5_WIND_DIR_CORRECTION_DEG,
    layers: { brigades: true, population: true },
    evac: {
      alertMin: { value: 6 * 60, source: null },
      personsPerHousehold: { value: 2.9, source: null },
      footShare: { value: 0.5, source: null },
    },
    calendarNote: 'La fecha real del escenario fue un viernes de vacaciones de verano.',
  },
  'eaton-2025': {
    id: 'eaton-2025',
    label: 'Eaton, Altadena y Pasadena (California) · 7 ene 2025',
    subtitle: 'Explorador de escenarios del incendio Eaton del 7 de enero de 2025 · Altadena y Pasadena, California',
    dir: 'eaton-2025/',
    horizonMin: 18 * 60, // 18:00 on 7 Jan to 12:00 on 8 Jan: the first night and morning
    windDirCorrectionDeg: 0,
    layers: { brigades: false, population: false },
    evac: {
      alertMin: { value: NaN, source: null },
      personsPerHousehold: { value: NaN, source: null },
      footShare: { value: NaN, source: null },
    },
    calendarNote: null,
  },
}

export function isEventId(s: string): s is EventId {
  return (EVENT_IDS as readonly string[]).includes(s)
}

/** The event named by ?evento= (Viña when absent). Throws on an unknown id. */
export function eventFromSearch(search: string): EventDef {
  const id = new URLSearchParams(search).get('evento')
  if (id === null || id === '') return EVENTS[DEFAULT_EVENT]
  if (!isEventId(id)) throw new Error(`Evento desconocido "${id}" (disponibles: ${EVENT_IDS.join(', ')})`)
  return EVENTS[id]
}

/** Every number of the registry must be finite: a missing value stops here, not deep in an engine. */
export function checkEvent(e: EventDef): EventDef {
  const nums: [string, number][] = [
    ['horizonMin', e.horizonMin],
    ['windDirCorrectionDeg', e.windDirCorrectionDeg],
    ['evac.alertMin', e.evac.alertMin.value],
    ['evac.personsPerHousehold', e.evac.personsPerHousehold.value],
    ['evac.footShare', e.evac.footShare.value],
  ]
  for (const [k, v] of nums) if (!Number.isFinite(v)) throw new Error(`Evento ${e.id}: "${k}" no está definido`)
  return e
}

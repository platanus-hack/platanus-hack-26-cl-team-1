// The historical events whose data is baked (pipeline/bake.py --event <id>), one territory and grid each, and
// what differs between them: data folder, horizon, wind correction, which optional layers ship, evacuation
// defaults with their sources. Each timeline (TIMELINE in types.ts) is shown on one of them: the "today"
// timelines reuse Viña's and Talca's territories (src/data/timeline.ts).
import { DEFAULT_EVAC_PARAMS } from '../engine/evac'
import { DEFAULT_FIRE_PARAMS } from '../engine/fire'
import { ERA5_WIND_DIR_CORRECTION_DEG } from '../engine/fire/model'
import { checkPresenceParams, DEFAULT_PRESENCE_PARAMS } from '../engine/population'
import { TIMELINE, type PresenceParams, type TimelineId } from '../engine/types'

export const EVENT_IDS = [TIMELINE.VINA_2024, TIMELINE.EATON_2025, TIMELINE.TALCA] as const
export type EventId = (typeof EVENT_IDS)[number]

/** A value used by default, with where it comes from (null source = labelled assumption). */
export interface Sourced<T> {
  value: T
  source: string | null
}

export interface EventDef {
  id: EventId
  /** Data folder under public/data/ ('' = the root: Viña's files stayed where they were). */
  dir: string
  /** Simulation horizon, minutes since GridMeta.t0. */
  horizonMin: number
  /** Correction added to the historical ERA5 wind direction (deg). Fitted on Viña's scar only; 0 elsewhere
   *  (a site fit, not part of the model: engine/fire/MODEL.md section 6b). */
  windDirCorrectionDeg: number
  /** Optional layers this event ships: brigades.json, population_{home,work}.bin, plan.json. */
  layers: { brigades: boolean; population: boolean; plan: boolean }
  /** A real fire was observed here: the scar, FIRMS and the Validación section mean something. False for a
   *  hypothetical scenario (Talca), whose scar.bin is all "no data" and firms.json empty. */
  observedFire: boolean
  /** Evacuation defaults that depend on the place. */
  evac: {
    alertMin: Sourced<number>
    personsPerHousehold: Sourced<number>
    footShare: Sourced<number>
  }
  /** Calendar of the real date, for the population section (Spanish), or null. */
  calendarNote: string | null
  /** Who is out at work or school by time of day (src/engine/population), and where those shares come from
   *  (Spanish, for "Fuentes"; null = the Chilean assumptions documented in engine/population/MODEL.md). */
  presence: { params: PresenceParams; source: string | null }
}

/** Eaton: Los Angeles County shares (US Census, ACS 2020-2024 5-year: population B01003 9,808,667; workers 16+
 *  B08301 4,687,090, of whom 801,832 worked from home, so commuters 3,885,258 = 0.396 of the population;
 *  enrolled in school B14001 2,382,781 = 0.243). Pasadena Unified (Altadena and Pasadena) 2024-25 calendar:
 *  winter break 23 Dec to 3 Jan, second semester from 6 Jan, so classes were on for Tuesday 7 Jan 2025; the
 *  term's start and end dates are approximate (mid-August to mid-June). Hours: the Chilean assumptions. */
const EATON_PRESENCE: PresenceParams = {
  workerShare: 0.396,
  studentShare: 0.243,
  workSchedule: DEFAULT_PRESENCE_PARAMS.workSchedule,
  schoolSchedule: DEFAULT_PRESENCE_PARAMS.schoolSchedule,
  schoolTerm: {
    start: [8, 15],
    end: [6, 15],
    winterBreak: [
      [12, 23],
      [1, 3],
    ],
  },
}

export const EVENTS: Record<EventId, EventDef> = {
  [TIMELINE.VINA_2024]: {
    id: TIMELINE.VINA_2024,
    dir: '',
    horizonMin: DEFAULT_FIRE_PARAMS.horizonMin, // 12:00 to midnight: the model has no suppression, so later hours overburn
    windDirCorrectionDeg: ERA5_WIND_DIR_CORRECTION_DEG,
    layers: { brigades: true, population: true, plan: true },
    observedFire: true,
    evac: {
      alertMin: { value: DEFAULT_EVAC_PARAMS.alertMin, source: null },
      personsPerHousehold: { value: DEFAULT_EVAC_PARAMS.personsPerHousehold, source: null },
      footShare: { value: DEFAULT_EVAC_PARAMS.footShare, source: null },
    },
    calendarNote: 'La fecha real del escenario fue un viernes de vacaciones de verano.',
    presence: { params: DEFAULT_PRESENCE_PARAMS, source: null },
  },
  [TIMELINE.EATON_2025]: {
    id: TIMELINE.EATON_2025,
    dir: 'eaton-2025/',
    horizonMin: 18 * 60, // 18:00 on 7 Jan to 12:00 on 8 Jan (Pacific time): the first night and morning
    windDirCorrectionDeg: 0,
    layers: { brigades: true, population: true, plan: false },
    observedFire: true,
    evac: {
      // 19:25: the first evacuation orders (east of Lake Avenue). West of Lake the first order came at 03:25.
      alertMin: {
        value: 85,
        source:
          'primeras órdenes de evacuación, al este de Lake Avenue, a las 19:25 del 7 ene (Los Angeles Times, 26 ene 2025, según alertas archivadas; actualización de CAL FIRE de las 19:25, https://www.fire.ca.gov/incidents/2025/1/7/eaton-fire). Al oeste de Lake Avenue la primera orden fue a las 03:25 del 8 ene (Condado de Los Ángeles, 18 may 2026, https://lacounty.gov/2026/05/18/county-of-los-angeles-fire-department-releases-independent-investigation-findings-of-west-altadena-evacuation-decisions/)',
      },
      personsPerHousehold: {
        value: 2.7,
        source: 'US Census, ACS 2020-2024 (5 años), tabla B25010: 2,70 personas por hogar en Altadena (2,30 en Pasadena), https://censusreporter.org/profiles/16000US0601290-altadena-ca/',
      },
      footShare: {
        value: 0.04,
        source:
          'supuesto derivado: a pie solo los hogares sin vehículo, 570 de 15.092 en Altadena (3,8 %; US Census, ACS 2020-2024, tabla B08201); no se encontró una encuesta de cómo evacuaron los hogares en el incendio Eaton',
      },
    },
    calendarNote: 'La fecha real fue un martes con clases (Pasadena Unified volvió de vacaciones el 6 de enero).',
    presence: {
      params: EATON_PRESENCE,
      source:
        'Condado de Los Ángeles, US Census ACS 2020-2024 (5 años): trabajan fuera de casa 3.885.258 personas (tabla B08301, sin contar a quienes trabajan desde casa) de 9.808.667 habitantes (B01003), 39,6 %; estudian 2.382.781 (B14001), 24,3 %. Calendario de Pasadena Unified 2024-25 (vacaciones de invierno del 23 dic al 3 ene, https://resources.finalsite.net/images/v1721079687/pusdus/olmfqhmifggjwi9ilv0c/OfficialSchoolYearCalendar2024-25.pdf); inicio y fin del año escolar aproximados. Horarios de trabajo y de clases: los mismos supuestos que en Chile.',
    },
  },
  [TIMELINE.TALCA]: {
    id: TIMELINE.TALCA,
    dir: 'talca/',
    horizonMin: 12 * 60, // 12:00 to midnight, the same window as Viña's validated replay
    windDirCorrectionDeg: 0, // the -10 deg correction was fitted on Viña's scar only
    layers: { brigades: false, population: true, plan: false },
    observedFire: false,
    evac: {
      // 17:00: three hours after the hypothetical 14:00 ignition. A labelled assumption, like Viña's 18:00.
      alertMin: { value: 5 * 60, source: null },
      personsPerHousehold: { value: DEFAULT_EVAC_PARAMS.personsPerHousehold, source: null },
      footShare: { value: DEFAULT_EVAC_PARAMS.footShare, source: null },
    },
    calendarNote: 'El día de referencia, 8 de febrero de 2025, fue un sábado.',
    presence: { params: DEFAULT_PRESENCE_PARAMS, source: null },
  },
}

/** The baked event a timeline is shown on. */
export function eventOfTimeline(t: TimelineId): EventId {
  if (t === TIMELINE.TODAY) return TIMELINE.VINA_2024
  if (t === TIMELINE.TODAY_TALCA) return TIMELINE.TALCA
  return t
}

/** Every number of the registry must be finite and in range: a bad value stops here, not deep in an engine. */
export function checkEvent(e: EventDef): EventDef {
  const nums: [string, number][] = [
    ['horizonMin', e.horizonMin],
    ['windDirCorrectionDeg', e.windDirCorrectionDeg],
    ['evac.alertMin', e.evac.alertMin.value],
    ['evac.personsPerHousehold', e.evac.personsPerHousehold.value],
    ['evac.footShare', e.evac.footShare.value],
  ]
  for (const [k, v] of nums) if (!Number.isFinite(v)) throw new Error(`Evento ${e.id}: "${k}" no está definido`)
  if (e.evac.footShare.value < 0 || e.evac.footShare.value > 1) throw new Error(`Evento ${e.id}: "evac.footShare" fuera de 0..1`)
  if (e.evac.alertMin.value < 0 || e.evac.alertMin.value > e.horizonMin) throw new Error(`Evento ${e.id}: la alerta queda fuera del horizonte`)
  checkPresenceParams(e.presence.params)
  return e
}

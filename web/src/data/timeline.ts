// The timelines the explorer can simulate (TIMELINE in types.ts) and the dataset each one sees. The UI thread and
// the simulation worker both call timelineDataset() with the same choice, so they see the same clock, weather
// and ignitions.
import type { BrigadesFile, IgnitionPreset, TimelineId } from '../engine/types'
import { TIMELINE } from '../engine/types'
import { TALCA_FORECAST_POINT, VINA_FORECAST_POINT, type Forecast, type ForecastPoint } from './forecast'
import type { Dataset } from './load'
import { eventOfTimeline } from './events'
import { localToMin, minToLocalIso } from './time'

/** The today timeline covers the whole local day: from 00:00 for 24 hours. */
export const TODAY_START = '00:00'
export const TODAY_HORIZON_MIN = 24 * 60

/** The timelines that start today: each one shows a baked territory (eventOfTimeline) with today's forecast. */
export const TODAY_TIMELINES = [TIMELINE.TODAY, TIMELINE.TODAY_TALCA] as const
export type TodayTimelineId = (typeof TODAY_TIMELINES)[number]

export function isTodayTimeline(t: TimelineId): t is TodayTimelineId {
  return (TODAY_TIMELINES as readonly string[]).includes(t)
}

/** What differs between the today timelines: where the forecast is asked for, and whether the day starts with the
 *  territory's preset ignitions moved to today (Viña: the 2024 points at the same time of day) or with none (Talca:
 *  a blank map, the user places every fire start). */
export const TODAY_DEFS: Record<TodayTimelineId, { point: ForecastPoint; presetIgnitions: boolean }> = {
  [TIMELINE.TODAY]: { point: VINA_FORECAST_POINT, presetIgnitions: true },
  [TIMELINE.TODAY_TALCA]: { point: TALCA_FORECAST_POINT, presetIgnitions: false },
}

/** What the worker needs to rebuild the UI's view of the dataset (sent once, with init). */
export type TimelineChoice =
  | { id: typeof TIMELINE.VINA_2024 }
  | { id: typeof TIMELINE.EATON_2025 }
  | { id: typeof TIMELINE.TALCA }
  | { id: TodayTimelineId; forecast: Forecast }

/** The 2024 choice as one shared object: the explorer re-creates its worker when the choice's identity changes. */
export const VINA_2024_CHOICE: TimelineChoice = { id: TIMELINE.VINA_2024 }
/** Same for the Eaton fire (its own baked event, src/data/events.ts). */
export const EATON_2025_CHOICE: TimelineChoice = { id: TIMELINE.EATON_2025 }
/** Same for the hypothetical Talca scenario. */
export const TALCA_CHOICE: TimelineChoice = { id: TIMELINE.TALCA }

/** Order and labels of the scenario picker (`short` on narrow screens). */
export const TIMELINE_OPTIONS: { value: TimelineId; label: string; short: string }[] = [
  { value: TIMELINE.TODAY, label: 'Desde hoy (pronóstico)', short: 'Desde hoy' },
  { value: TIMELINE.TODAY_TALCA, label: 'Hoy · Talca (pronóstico)', short: 'Hoy Talca' },
  { value: TIMELINE.VINA_2024, label: '2 feb 2024 · Viña del Mar', short: '2 feb 2024' },
  { value: TIMELINE.EATON_2025, label: '7 ene 2025 · Eaton, California', short: 'Eaton 2025' },
  { value: TIMELINE.TALCA, label: 'Talca, Maule · hipotético', short: 'Talca (hipot.)' },
]

export function isTimelineId(v: string | null): v is TimelineId {
  return v !== null && (Object.values(TIMELINE) as string[]).includes(v)
}

/** The dataset as seen from a timeline. `base` must be the baked files of the timeline's event
 *  (eventOfTimeline: Viña's for the 2024 and today timelines, Talca's for both Talca timelines, Eaton's for Eaton). */
export function timelineDataset(base: Dataset, choice: TimelineChoice): Dataset {
  const want = eventOfTimeline(choice.id)
  if (base.timeline !== want) throw new Error(`timelineDataset: se esperaban los datos de "${want}", no "${base.timeline}"`)
  return 'forecast' in choice ? todayDataset(base, choice.forecast, choice.id) : base
}

/** A "today" timeline: the same territory, buildings, streets, population and fire companies, with
 *  - the clock covering today, 00:00 to 24:00 (TODAY_HORIZON_MIN);
 *  - today's forecast as the weather, without the wind-direction correction fitted on 2024's ERA5;
 *  - the base day's ignition points at the same time of day, or none (TODAY_DEFS: Talca starts blank);
 *  - the base day's dispatch, reinforcement and road-cut times (brigades.json) and the default alert at the same
 *    time of day (on Viña, as on 2 Feb 2024: 12:05, 14:17, 15:10, 17:00, 18:00, ...);
 *  - no satellite detections (FIRMS). The 2024 scar stays as a reference layer. */
export function todayDataset(base: Dataset, f: Forecast, id: TodayTimelineId = TIMELINE.TODAY): Dataset {
  const t0 = `${f.date}T${TODAY_START}:00${f.utcOffset}`
  // Same time of day: minutes after the base day's local midnight, moved to today's midnight (a time on the
  // next day of 2024 lands on tomorrow).
  const baseMidnight = `${base.grid.t0.slice(0, 10)}T00:00`
  const retime = (local: string) => minToLocalIso(t0, localToMin(baseMidnight, local))
  const ignitions: IgnitionPreset[] = !TODAY_DEFS[id].presetIgnitions ? [] : base.ignitions.map((g) => ({
    ...g,
    label: `Mismo punto que el 2 feb 2024: ${g.label}`,
    timeLocal: retime(g.timeLocal),
    source: `Punto y hora del día de un foco del 2 feb 2024. ${g.source}`,
  }))
  const b = base.brigades
  const brigades: BrigadesFile | null = b && {
    ...b,
    dispatch: b.dispatch.map((d) => ({ ...d, dispatchLocal: retime(d.dispatchLocal) })),
    reinforcements: b.reinforcements.map((r) => ({ ...r, arrivalLocal: retime(r.arrivalLocal) })),
    cuts: b.cuts.map((c) => ({
      ...c,
      label: `${c.label} (como el 2 feb 2024)`,
      fromLocal: retime(c.fromLocal),
      toLocal: c.toLocal === null ? null : retime(c.toLocal),
    })),
  }
  return {
    ...base,
    grid: { ...base.grid, t0 },
    weather: f.weather,
    ignitions,
    firms: [],
    brigades,
    timeline: id,
    windDirCorrectionDeg: 0,
    horizonMin: TODAY_HORIZON_MIN,
    defaultAlertMin: localToMin(t0, retime(minToLocalIso(base.grid.t0, base.defaultAlertMin))),
  }
}

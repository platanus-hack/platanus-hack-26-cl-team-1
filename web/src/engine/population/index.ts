// Where people are at a given local time: at home (population_home.bin) or at work or school
// (population_work.bin). Model, sources and limits: MODEL.md. Pure TypeScript (no DOM): runs in the UI, the
// worker and Node.
//
// Times are wall-clock minutes since the Unix epoch, as src/data/time.ts wallClockMin() returns them (the local
// time read as if it were UTC): only the local calendar date, weekday and hour matter here.
import type { PopulationDay, PresenceParams } from '../types'
import { POPULATION_DAY } from '../types'

/** Employed persons / population. INE, Encuesta Nacional de Empleo, Oct-Dec 2024 (press release of
 *  2025-01-31): labour force 10.12 million, 817,996 unemployed, so ~9.30 million employed; Censo 2024 counted
 *  18,480,432 persons (INE, 2025-03-27). 9.30 / 18.48 = 0.503. */
export const WORKER_SHARE = 0.503
/** Enrolled students / population. Mineduc: school enrolment 2025 3,541,790 (the 2024 figure was not found)
 *  and higher-education enrolment 2024 1,385,828; (3.54 + 1.39) / 18.48 = 0.267. Students who also work are
 *  counted twice (a small overlap, not corrected). */
export const STUDENT_SHARE = 0.267

export const DEFAULT_PRESENCE_PARAMS: PresenceParams = {
  workerShare: WORKER_SHARE,
  studentShare: STUDENT_SHARE,
  // Assumptions, not measurements: a 09:00-18:00 working day with an hour's commute either side.
  workSchedule: [
    [0, 0],
    [7, 0],
    [9, 1],
    [18, 1],
    [20, 0],
    [24, 0],
  ],
  // Assumptions: a full school day (Jornada Escolar Completa) about 08:00-15:30, plus the trip.
  schoolSchedule: [
    [0, 0],
    [7.5, 0],
    [8.5, 1],
    [15.5, 1],
    [17, 0],
    [24, 0],
  ],
  // Approximate national school calendar (the exact dates change by year and region): classes from 1 March to
  // 15 December, with a two-week winter break in early July. Summer holidays have no students out.
  schoolTerm: {
    start: [3, 1],
    end: [12, 15],
    winterBreak: [
      [7, 1],
      [7, 14],
    ],
  },
}

export class PresenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresenceError'
  }
}

function checkSchedule(name: string, knots: [number, number][]) {
  if (knots.length < 2) throw new PresenceError(`${name}: se necesitan al menos 2 puntos`)
  if (knots[0][0] !== 0 || knots[knots.length - 1][0] !== 24) throw new PresenceError(`${name}: debe ir de las 0 a las 24 h`)
  for (let i = 0; i < knots.length; i++) {
    const [h, v] = knots[i]
    if (!Number.isFinite(h) || !Number.isFinite(v) || v < 0 || v > 1) throw new PresenceError(`${name}: punto ${i} inválido (${h}, ${v})`)
    if (i > 0 && h <= knots[i - 1][0]) throw new PresenceError(`${name}: las horas deben ser crecientes`)
  }
}

/** Throws a PresenceError on shares outside 0..1, more than everyone out, or malformed schedules. */
export function checkPresenceParams(p: PresenceParams): void {
  for (const [k, v] of [
    ['workerShare', p.workerShare],
    ['studentShare', p.studentShare],
  ] as const)
    if (!(v >= 0 && v <= 1)) throw new PresenceError(`${k} debe estar entre 0 y 1 (es ${v})`)
  if (p.workerShare + p.studentShare > 1) throw new PresenceError('workerShare + studentShare no puede superar 1')
  checkSchedule('workSchedule', p.workSchedule)
  checkSchedule('schoolSchedule', p.schoolSchedule)
}

/** Linear interpolation of a [hour, share] schedule at `hour` (0..24). */
export function scheduleAt(knots: [number, number][], hour: number): number {
  for (let i = 1; i < knots.length; i++) {
    const [h1, v1] = knots[i]
    if (hour <= h1) {
      const [h0, v0] = knots[i - 1]
      return v0 + ((v1 - v0) * (hour - h0)) / (h1 - h0)
    }
  }
  return knots[knots.length - 1][1]
}

const md = (m: number, d: number) => m * 100 + d

/** Whether classes are held on that calendar date (weekday or not: the caller handles weekends). */
export function inSchoolTerm(month: number, day: number, p: PresenceParams): boolean {
  const x = md(month, day)
  const t = p.schoolTerm
  if (x < md(...t.start) || x > md(...t.end)) return false
  return !(x >= md(...t.winterBreak[0]) && x <= md(...t.winterBreak[1]))
}

/** The calendar facts the presence model uses for a wall-clock minute: day of week (0 = Sunday), whether it is a
 *  weekday, and whether classes are held (weekday inside the school term). Public holidays are not modelled. */
export function dayKind(wallMin: number, p: PresenceParams = DEFAULT_PRESENCE_PARAMS): { dow: number; weekday: boolean; school: boolean } {
  const d = new Date(wallMin * 60000)
  const dow = d.getUTCDay()
  const weekday = dow !== 0 && dow !== 6
  return { dow, weekday, school: weekday && inSchoolTerm(d.getUTCMonth() + 1, d.getUTCDate(), p) }
}

/** Share (0..1) of all residents who are at work or school at that local wall-clock time. `day` replaces the
 *  real calendar: REAL uses the date's own weekday and school term; WEEKEND is everyone home. Public holidays
 *  are not modelled (they count as the weekday they fall on). */
export function awayShare(wallMin: number, p: PresenceParams = DEFAULT_PRESENCE_PARAMS, day: PopulationDay = POPULATION_DAY.REAL): number {
  const d = new Date(wallMin * 60000)
  let weekday: boolean
  let school: boolean
  switch (day) {
    case POPULATION_DAY.REAL:
      ;({ weekday, school } = dayKind(wallMin, p))
      break
    case POPULATION_DAY.WEEKDAY_SCHOOL:
      weekday = true
      school = true
      break
    case POPULATION_DAY.WEEKDAY_NO_SCHOOL:
      weekday = true
      school = false
      break
    case POPULATION_DAY.WEEKEND:
      weekday = false
      school = false
      break
  }
  if (!weekday) return 0
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60
  return p.workerShare * scheduleAt(p.workSchedule, hour) + (school ? p.studentShare * scheduleAt(p.schoolSchedule, hour) : 0)
}

/** People in each cell when a share `away` of residents is at work or school: home + away * (work - home). */
export function populationAt(home: Float32Array, work: Float32Array, away: number, out = new Float32Array(home.length)): Float32Array {
  if (work.length !== home.length || out.length !== home.length) throw new PresenceError('las capas de población no tienen el mismo largo')
  for (let i = 0; i < home.length; i++) out[i] = home[i] + away * (work[i] - home[i])
  return out
}

export interface BurnedAreaPeople {
  /** People present in the cells the fire reaches, each cell counted at the local time the fire reaches it. */
  present: number
  /** Residents of those cells (the night-time and weekend count). */
  residents: number
  /** Share away from home at the first arrival of the fire (for the label); NaN if nothing burns. */
  awayAtFirstArrival: number
}

/** How many people are where the fire arrives, when it arrives. `wallMin0` is the wall-clock minute of t0
 *  (wallClockMin(grid.t0)); arrivalMin is minutes since t0, Infinity where the fire does not arrive. */
export function peopleInBurnedArea(
  arrivalMin: Float32Array,
  home: Float32Array,
  work: Float32Array,
  wallMin0: number,
  p: PresenceParams = DEFAULT_PRESENCE_PARAMS,
  day: PopulationDay = POPULATION_DAY.REAL,
): BurnedAreaPeople {
  if (arrivalMin.length !== home.length || work.length !== home.length)
    throw new PresenceError('arrivalMin y las capas de población no tienen el mismo largo')
  checkPresenceParams(p)
  const byMinute = new Map<number, number>()
  let present = 0
  let residents = 0
  let first = Infinity
  for (let i = 0; i < arrivalMin.length; i++) {
    const t = arrivalMin[i]
    if (!Number.isFinite(t)) continue
    const m = Math.floor(t)
    let away = byMinute.get(m)
    if (away === undefined) {
      away = awayShare(wallMin0 + m, p, day)
      byMinute.set(m, away)
    }
    present += home[i] + away * (work[i] - home[i])
    residents += home[i]
    if (t < first) first = t
  }
  return { present, residents, awayAtFirstArrival: Number.isFinite(first) ? awayShare(wallMin0 + Math.floor(first), p, day) : NaN }
}

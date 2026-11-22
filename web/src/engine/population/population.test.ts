// Time-of-day presence: who is home, who is at work or school, and how many people the fire reaches.
import { describe, expect, it } from 'vitest'
import { wallClockMin } from '../../data/time'
import { POPULATION_DAY, type PresenceParams } from '../types'
import {
  awayShare,
  checkPresenceParams,
  DEFAULT_PRESENCE_PARAMS as P,
  inSchoolTerm,
  peopleInBurnedArea,
  populationAt,
  PresenceError,
  scheduleAt,
  STUDENT_SHARE,
  WORKER_SHARE,
} from './index'

const at = (iso: string) => wallClockMin(iso)

describe('awayShare', () => {
  it('is zero at night and all weekend, whatever the day override', () => {
    expect(awayShare(at('2024-04-10T03:00'))).toBe(0) // Wednesday, term time
    expect(awayShare(at('2024-04-10T23:00'))).toBe(0)
    expect(awayShare(at('2024-02-03T12:00'))).toBe(0) // Saturday
    expect(awayShare(at('2024-02-04T12:00'))).toBe(0) // Sunday
    expect(awayShare(at('2024-02-02T12:00'), P, POPULATION_DAY.WEEKEND)).toBe(0) // the fire's Friday, as a weekend
  })

  it('sends workers out on the fire day (a Friday in the summer holidays) but no students', () => {
    expect(awayShare(at('2024-02-02T14:00'))).toBeCloseTo(WORKER_SHARE, 12)
    expect(awayShare(at('2024-02-02T19:00'))).toBeCloseTo(WORKER_SHARE / 2, 12) // half-way home
    expect(awayShare(at('2024-02-02T20:00'))).toBe(0)
  })

  it('adds students on a school day, and ramps both in the morning', () => {
    expect(awayShare(at('2024-04-10T11:00'))).toBeCloseTo(WORKER_SHARE + STUDENT_SHARE, 12)
    // 08:00: workers half-way through their 07-09 ramp, students half-way through 07:30-08:30.
    expect(awayShare(at('2024-04-10T08:00'))).toBeCloseTo(0.5 * WORKER_SHARE + 0.5 * STUDENT_SHARE, 12)
    expect(awayShare(at('2024-07-10T11:00'))).toBeCloseTo(WORKER_SHARE, 12) // winter break
    // Overrides ignore the calendar: a Saturday as a school weekday, a term-time Wednesday without classes.
    expect(awayShare(at('2024-02-03T11:00'), P, POPULATION_DAY.WEEKDAY_SCHOOL)).toBeCloseTo(WORKER_SHARE + STUDENT_SHARE, 12)
    expect(awayShare(at('2024-04-10T11:00'), P, POPULATION_DAY.WEEKDAY_NO_SCHOOL)).toBeCloseTo(WORKER_SHARE, 12)
  })
})

describe('calendar and schedules', () => {
  it('school term boundaries are inclusive and skip the winter break', () => {
    expect(inSchoolTerm(2, 29, P)).toBe(false)
    expect(inSchoolTerm(3, 1, P)).toBe(true)
    expect(inSchoolTerm(6, 30, P)).toBe(true)
    expect(inSchoolTerm(7, 1, P)).toBe(false)
    expect(inSchoolTerm(7, 14, P)).toBe(false)
    expect(inSchoolTerm(7, 15, P)).toBe(true)
    expect(inSchoolTerm(12, 15, P)).toBe(true)
    expect(inSchoolTerm(12, 16, P)).toBe(false)
  })

  it('handles a school year and a winter break that cross New Year (August to June)', () => {
    const us = { ...P, schoolTerm: { start: [8, 15] as [number, number], end: [6, 15] as [number, number], winterBreak: [[12, 23], [1, 3]] as [[number, number], [number, number]] } }
    expect(inSchoolTerm(8, 14, us)).toBe(false)
    expect(inSchoolTerm(8, 15, us)).toBe(true)
    expect(inSchoolTerm(12, 22, us)).toBe(true)
    expect(inSchoolTerm(12, 31, us)).toBe(false)
    expect(inSchoolTerm(1, 3, us)).toBe(false)
    expect(inSchoolTerm(1, 7, us)).toBe(true) // the Eaton fire's Tuesday
    expect(inSchoolTerm(6, 15, us)).toBe(true)
    expect(inSchoolTerm(7, 1, us)).toBe(false)
  })

  it('interpolates schedules linearly', () => {
    expect(scheduleAt(P.workSchedule, 0)).toBe(0)
    expect(scheduleAt(P.workSchedule, 8)).toBeCloseTo(0.5, 12)
    expect(scheduleAt(P.workSchedule, 12)).toBe(1)
    expect(scheduleAt(P.workSchedule, 24)).toBe(0)
  })

  it('rejects impossible parameters instead of clamping them', () => {
    const bad = (patch: Partial<PresenceParams>) => () => checkPresenceParams({ ...P, ...patch })
    expect(bad({ workerShare: 1.2 })).toThrow(PresenceError)
    expect(bad({ workerShare: 0.8, studentShare: 0.3 })).toThrow(PresenceError)
    expect(bad({ workSchedule: [[0, 0], [12, 1.5], [24, 0]] })).toThrow(PresenceError)
    expect(bad({ schoolSchedule: [[0, 0], [9, 1], [8, 1], [24, 0]] })).toThrow(PresenceError)
    expect(bad({ schoolSchedule: [[1, 0], [24, 0]] })).toThrow(PresenceError)
    expect(() => checkPresenceParams(P)).not.toThrow()
  })
})

describe('populationAt and peopleInBurnedArea', () => {
  // Three cells: a dormitory suburb, a mixed block and an office district; the same 300 people in all.
  const home = new Float32Array([200, 80, 20])
  const work = new Float32Array([40, 60, 200])

  it('moves people without creating them', () => {
    for (const away of [0, 0.25, 0.77, 1]) {
      const n = populationAt(home, work, away)
      expect(n.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 3)
    }
    expect(Array.from(populationAt(home, work, 0))).toEqual([200, 80, 20])
    expect(Array.from(populationAt(home, work, 1))).toEqual([40, 60, 200])
  })

  it('counts each burned cell at the time the fire reaches it', () => {
    const t0 = at('2024-02-02T12:00') // Friday, summer holidays
    // Cell 0 burns at 14:00 (workers out), cell 2 at 22:00 (everyone home), cell 1 never.
    const arrival = new Float32Array([120, Infinity, 600])
    const r = peopleInBurnedArea(arrival, home, work, t0)
    expect(r.residents).toBeCloseTo(220, 6)
    expect(r.present).toBeCloseTo(200 + WORKER_SHARE * (40 - 200) + 20, 4)
    expect(r.awayAtFirstArrival).toBeCloseTo(WORKER_SHARE, 12)
    // The same fire on a weekend: everyone is home.
    const w = peopleInBurnedArea(arrival, home, work, t0, P, POPULATION_DAY.WEEKEND)
    expect(w.present).toBeCloseTo(220, 6)
    // Nothing burns.
    const none = peopleInBurnedArea(new Float32Array([Infinity, Infinity, Infinity]), home, work, t0)
    expect(none.present).toBe(0)
    expect(none.awayAtFirstArrival).toBeNaN()
  })

  it('refuses layers of different sizes', () => {
    expect(() => peopleInBurnedArea(new Float32Array(2), home, work, 0)).toThrow(PresenceError)
    expect(() => populationAt(home, new Float32Array(2), 0.5)).toThrow(PresenceError)
  })
})

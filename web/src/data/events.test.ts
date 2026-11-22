import { describe, expect, it } from 'vitest'
import { TIMELINE } from '../engine/types'
import { checkEvent, EVENT_IDS, EVENTS, eventOfTimeline } from './events'

describe('event registry', () => {
  it('has every event complete, with its own data folder', () => {
    const dirs = new Set<string>()
    for (const id of EVENT_IDS) {
      const e = checkEvent(EVENTS[id])
      expect(e.id).toBe(id)
      expect(dirs.has(e.dir)).toBe(false)
      dirs.add(e.dir)
    }
  })
  it('stops on a missing or out-of-range number', () => {
    expect(() => checkEvent({ ...EVENTS[TIMELINE.VINA_2024], horizonMin: NaN })).toThrow(/horizonMin/)
    const e = EVENTS[TIMELINE.EATON_2025]
    expect(() => checkEvent({ ...e, evac: { ...e.evac, footShare: { value: 1.5, source: null } } })).toThrow(/footShare/)
  })
  it('shows the today timeline on Viña and each historical timeline on its own event', () => {
    expect(eventOfTimeline(TIMELINE.TODAY)).toBe(TIMELINE.VINA_2024)
    expect(eventOfTimeline(TIMELINE.VINA_2024)).toBe(TIMELINE.VINA_2024)
    expect(eventOfTimeline(TIMELINE.EATON_2025)).toBe(TIMELINE.EATON_2025)
  })
})

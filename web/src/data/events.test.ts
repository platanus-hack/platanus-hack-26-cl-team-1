import { describe, expect, it } from 'vitest'
import { checkEvent, DEFAULT_EVENT, EVENT_IDS, EVENTS, eventFromSearch } from './events'

describe('eventFromSearch', () => {
  it('is Viña without ?evento=', () => {
    expect(eventFromSearch('').id).toBe(DEFAULT_EVENT)
    expect(eventFromSearch('?mock').id).toBe(DEFAULT_EVENT)
  })
  it('picks the named event', () => {
    expect(eventFromSearch('?evento=eaton-2025').id).toBe('eaton-2025')
  })
  it('refuses an unknown id instead of falling back to Viña', () => {
    expect(() => eventFromSearch('?evento=atlantis-1900')).toThrow(/desconocido/)
  })
})

describe('event registry', () => {
  it('has every event complete (finite defaults, own data folder)', () => {
    const dirs = new Set<string>()
    for (const id of EVENT_IDS) {
      const e = checkEvent(EVENTS[id])
      expect(e.id).toBe(id)
      expect(dirs.has(e.dir)).toBe(false)
      dirs.add(e.dir)
      expect(e.evac.footShare.value).toBeGreaterThanOrEqual(0)
      expect(e.evac.footShare.value).toBeLessThanOrEqual(1)
      expect(e.evac.alertMin.value).toBeGreaterThanOrEqual(0)
      expect(e.evac.alertMin.value).toBeLessThanOrEqual(e.horizonMin)
    }
  })
  it('stops on a missing number', () => {
    expect(() => checkEvent({ ...EVENTS['vina-2024'], horizonMin: NaN })).toThrow(/horizonMin/)
  })
})

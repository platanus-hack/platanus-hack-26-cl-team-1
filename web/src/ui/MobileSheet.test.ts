import { describe, expect, it } from 'vitest'
import { sheetHeights, snapAfterDrag } from './MobileSheet'

describe('sheetHeights', () => {
  it('opens to half the space and leaves a strip of map above the open sheet', () => {
    expect(sheetHeights(760, 150)).toEqual({ peek: 150, half: 380, full: 704 })
  })

  it('keeps the stops ordered on a short landscape screen', () => {
    const hs = sheetHeights(250, 150)
    expect(hs.peek).toBe(150)
    expect(hs.half).toBeGreaterThanOrEqual(hs.peek)
    expect(hs.full).toBeGreaterThanOrEqual(hs.half)
  })

  it('never makes the closed sheet taller than the space it sits in', () => {
    expect(sheetHeights(100, 150)).toEqual({ peek: 100, half: 100, full: 100 })
  })
})

describe('snapAfterDrag', () => {
  const hs = { peek: 150, half: 380, full: 704 }

  it('settles a slow release on the nearest stop', () => {
    expect(snapAfterDrag(200, 0, hs)).toBe('peek')
    expect(snapAfterDrag(420, 0, hs)).toBe('half')
    expect(snapAfterDrag(650, 0.1, hs)).toBe('full')
  })

  it('moves a flick one stop in its direction, even after a short drag', () => {
    expect(snapAfterDrag(170, 1.2, hs)).toBe('half')
    expect(snapAfterDrag(400, 1.2, hs)).toBe('full')
    expect(snapAfterDrag(690, -1.2, hs)).toBe('half')
    expect(snapAfterDrag(360, -1.2, hs)).toBe('peek')
  })

  it('stays at the end stops when flicked past them', () => {
    expect(snapAfterDrag(704, 2, hs)).toBe('full')
    expect(snapAfterDrag(150, -2, hs)).toBe('peek')
  })
})

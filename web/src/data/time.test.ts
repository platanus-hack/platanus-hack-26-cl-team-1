import { describe, expect, it } from 'vitest'
import { minToEndLabel } from './time'

describe('minToEndLabel', () => {
  it('names a midnight end 24:00 of the day before', () => {
    // Viña 2024: 12:00 on 2 Feb to midnight
    expect(minToEndLabel('2024-02-02T12:00', 12 * 60)).toBe('24:00 del 2 feb 2024')
  })

  it('gives the day of an end on a later date', () => {
    // Eaton: 18:00 on 7 Jan to noon on 8 Jan
    expect(minToEndLabel('2025-01-07T18:00', 18 * 60)).toBe('12:00 del 8 ene 2025')
  })
})

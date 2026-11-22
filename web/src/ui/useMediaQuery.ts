import { useSyncExternalStore } from 'react'

/** Below 900 px the explorer uses the phone layout: the map fills the screen and the controls live in a bottom
 *  sheet (styles.css uses the same width). */
export const NARROW_QUERY = '(max-width: 899px)'

/** Touch as the main pointer (phones, tablets): copy says "toca" instead of "haz clic". */
export const COARSE_QUERY = '(pointer: coarse)'

/** Whether a CSS media query matches, following changes (rotation, window resize). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

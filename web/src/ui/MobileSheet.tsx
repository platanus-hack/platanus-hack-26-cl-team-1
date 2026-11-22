import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

/** Phone layout: the scenario controls sit in a sheet over the bottom of the map, closed (results line and time
 *  bar), half open or open (a strip of map stays visible above it). */
export type SheetSnap = 'peek' | 'half' | 'full'

export type SheetHeights = Record<SheetSnap, number>

const SNAPS: readonly SheetSnap[] = ['peek', 'half', 'full']
/** Map left visible above the open sheet, so it reads as a sheet over the map and not a new page. */
const MAP_STRIP_PX = 56
/** A release faster than this (px/ms) moves one stop in its direction, however short the drag. */
const FLICK_PX_PER_MS = 0.45
/** A drag shorter than this is a tap (opens or closes the sheet). */
const TAP_SLOP_PX = 6
/** A click this soon after a drag ends belongs to the drag. */
const CLICK_AFTER_DRAG_MS = 400

/** Heights of the three stops, for a container `avail` px tall and a closed sheet `peek` px tall. */
export function sheetHeights(avail: number, peek: number): SheetHeights {
  const closed = Math.min(peek, avail)
  const full = Math.max(closed, avail - MAP_STRIP_PX)
  const half = Math.min(full, Math.max(closed, Math.round(avail * 0.5)))
  return { peek: closed, half, full }
}

/** Where a released drag settles: a flick goes to the next stop in its direction, a slow release to the nearest.
 *  `velocity` is px/ms, positive when the sheet grows (finger moving up). */
export function snapAfterDrag(height: number, velocity: number, hs: SheetHeights): SheetSnap {
  if (velocity > FLICK_PX_PER_MS) return SNAPS.find((s) => hs[s] > height + 1) ?? 'full'
  if (velocity < -FLICK_PX_PER_MS) return [...SNAPS].reverse().find((s) => hs[s] < height - 1) ?? 'peek'
  return SNAPS.reduce((best, s) => (Math.abs(hs[s] - height) < Math.abs(hs[best] - height) ? s : best), 'peek' as SheetSnap)
}

interface Drag {
  y0: number
  h0: number
  y: number
  t: number
  /** Latest finger speed, px/ms, positive upwards. */
  v: number
  moved: boolean
}

export function MobileSheet({
  snap,
  setSnap,
  summary,
  toolbar,
  onPeekHeight,
  children,
}: {
  snap: SheetSnap
  setSnap: (s: SheetSnap) => void
  /** The sheet's title line (the key results): tap it to open or close the sheet, drag it to resize. */
  summary: ReactNode
  /** Always visible under the title line, also when the sheet is closed (the time bar). */
  toolbar: ReactNode
  /** Height of the closed sheet, so the map keeps the grid above it. */
  onPeekHeight: (px: number) => void
  children: ReactNode
}) {
  const bodyId = useId()
  const sheetRef = useRef<HTMLElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ avail: 0, peek: 0 })
  const [dragH, setDragH] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  /** When the last drag ended: the click a browser may send right after it must not also toggle the sheet. */
  const dragEndedAt = useRef(-Infinity)

  // The sheet's stops depend on the space under the top bar and on the closed sheet's own height.
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    const top = topRef.current
    const parent = sheet?.parentElement
    if (!sheet || !top || !parent) return
    const measure = () => {
      // The sheet's bottom padding is the home-indicator safe area: the closed sheet keeps it clear.
      const pad = parseFloat(getComputedStyle(sheet).paddingBottom) || 0
      setBox({ avail: parent.clientHeight, peek: Math.ceil(top.offsetHeight + pad) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    ro.observe(top)
    return () => ro.disconnect()
  }, [])

  const hs = sheetHeights(box.avail, box.peek)
  const height = dragH ?? hs[snap]
  const clamp = (h: number) => Math.min(hs.full, Math.max(hs.peek, h))

  // Map overlays that stay above the sheet (MapLibre's scale and attribution) read its height.
  useLayoutEffect(() => {
    sheetRef.current?.parentElement?.style.setProperty('--sheet-h', `${height}px`)
  }, [height])
  useEffect(() => onPeekHeight(box.peek), [box.peek, onPeekHeight])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { y0: e.clientY, h0: height, y: e.clientY, t: e.timeStamp, v: 0, moved: false }
    // Keep the moves when the finger leaves the button. Capture fails only for a pointer that is no longer down,
    // whose drag then ends at its pointerup like any other.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* see above */
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientY - d.y0) < TAP_SLOP_PX) return
    d.moved = true
    d.v = (d.y - e.clientY) / Math.max(1, e.timeStamp - d.t)
    d.y = e.clientY
    d.t = e.timeStamp
    setDragH(clamp(d.h0 + (d.y0 - e.clientY)))
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) return
    dragEndedAt.current = e.timeStamp
    // A finger that stopped before lifting is not a flick.
    const v = e.timeStamp - d.t > 100 ? 0 : d.v
    setDragH(null)
    setSnap(snapAfterDrag(clamp(d.h0 + (d.y0 - e.clientY)), v, hs))
  }
  const onPointerCancel = () => {
    drag.current = null
    setDragH(null)
  }
  const onClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (e.timeStamp - dragEndedAt.current < CLICK_AFTER_DRAG_MS) return
    setSnap(snap === 'peek' ? 'half' : 'peek')
  }

  const closed = snap === 'peek' && dragH === null
  return (
    <section
      ref={sheetRef}
      className={`sheet${dragH !== null ? ' dragging' : ''}`}
      data-snap={snap}
      style={{ height }}
      aria-label="Controles del escenario"
    >
      <div ref={topRef} className="sheet-top">
        <button
          type="button"
          className="sheet-grab"
          aria-expanded={!closed}
          aria-controls={bodyId}
          title={closed ? 'Abrir controles y resultados' : 'Cerrar para ver el mapa'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={onClick}
        >
          <span className="sheet-handle" aria-hidden="true" />
          <span className="sheet-summary">{summary}</span>
          <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 7.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {toolbar}
      </div>
      {/* Closed, the controls are out of view: keep them out of the tab order too. */}
      <div id={bodyId} className="sheet-body" inert={closed}>
        {children}
      </div>
    </section>
  )
}

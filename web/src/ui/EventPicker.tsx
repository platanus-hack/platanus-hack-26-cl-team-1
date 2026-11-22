import { EVENT_IDS, EVENTS, isEventId, type EventId } from '../data/events'

/** Header selector of the historical event. Changing it reloads the page with ?evento=<id>: every event has its
 *  own grid, clock and files, so nothing of the current scenario carries over. */
export function EventPicker({ current }: { current: EventId }) {
  const go = (id: string) => {
    if (!isEventId(id) || id === current) return
    const url = new URL(window.location.href)
    url.searchParams.set('evento', id)
    window.location.assign(url.toString())
  }
  return (
    <label className="event-picker">
      <span className="muted small">Incendio</span>
      <select value={current} onChange={(e) => go(e.target.value)} aria-label="Incendio que se explora">
        {EVENT_IDS.map((id) => (
          <option key={id} value={id}>
            {EVENTS[id].label}
          </option>
        ))}
      </select>
    </label>
  )
}

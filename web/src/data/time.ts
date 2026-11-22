// Clock helpers. Engine time is "minutes since GridMeta.t0"; data files carry local ISO times without offset.
// We compare local wall-clock times directly (America/Santiago was UTC-3 all of Feb 2024, no DST change).

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/

/** Parses the wall-clock part of an ISO string ("2024-02-02T14:30", with or without seconds/offset) into
 *  minutes since the Unix epoch, treating it as UTC (only differences are meaningful). */
export function wallClockMin(iso: string): number {
  const m = LOCAL_RE.exec(iso)
  if (!m) throw new Error(`Hora inválida: "${iso}" (se esperaba AAAA-MM-DDTHH:MM)`)
  const [, y, mo, d, h, mi, s] = m
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0) / 60000
}

/** Minutes since t0 for a local ISO time. */
export function localToMin(t0: string, iso: string): number {
  return wallClockMin(iso) - wallClockMin(t0)
}

function wallClockDate(t0: string, min: number): Date {
  return new Date((wallClockMin(t0) + min) * 60000)
}

/** "HH:MM" of the wall clock at `min` minutes after t0. */
export function minToHHMM(t0: string, min: number): string {
  const d = wallClockDate(t0, Math.round(min))
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "2 feb 2024" for the wall-clock date at `min` minutes after t0. */
export function minToDateLabel(t0: string, min: number): string {
  const d = wallClockDate(t0, Math.round(min))
  return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Local ISO without offset ("2024-02-02T14:30") at `min` minutes after t0. */
export function minToLocalIso(t0: string, min: number): string {
  const d = wallClockDate(t0, Math.round(min))
  return d.toISOString().slice(0, 16)
}

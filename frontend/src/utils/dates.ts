// Las fechas de negocio YYYY-MM-DD NUNCA pasan por new Date("YYYY-MM-DD") (se interpreta como UTC y en Bogota
// mostraria el dia anterior). Se descomponen a mano y se formatean con la zona UTC sobre Date.UTC.
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

export interface Ymd {
  y: number
  m: number
  d: number
}

export function parseYmd(value: string): Ymd | null {
  const match = YMD.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return { y, m, d }
}

const SHORT = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const LONG = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function formatDate(value: string | undefined | null): string {
  if (!value) return '—'
  const p = parseYmd(value)
  if (!p) return value
  return SHORT.format(new Date(Date.UTC(p.y, p.m - 1, p.d)))
}

export function formatDateLong(value: string | undefined | null): string {
  if (!value) return '—'
  const p = parseYmd(value)
  if (!p) return value
  return LONG.format(new Date(Date.UTC(p.y, p.m - 1, p.d)))
}

/** "2026-12-04T07:15" (sin zona) -> "4 dic 2026, 07:15". No convierte zonas: es la hora local del dato. */
export function formatDateTime(value: string | undefined | null): string {
  if (!value) return '—'
  const [date, rest] = value.split('T')
  const time = rest ? rest.slice(0, 5) : ''
  const base = formatDate(date)
  return time ? `${base}, ${time}` : base
}

export function ymdToString(p: Ymd): string {
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** Fecha de hoy en Bogota (YYYY-MM-DD), con el mismo criterio que el backend. */
export function todayBogota(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Dias entre dos YYYY-MM-DD (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseYmd(a)
  const pb = parseYmd(b)
  if (!pa || !pb) return NaN
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000)
}

/** Dias YYYY-MM-DD entre start y end (ambos incluidos), maximo `limit`. */
export function eachDay(start: string, end: string, limit = 30): string[] {
  const a = parseYmd(start)
  const b = parseYmd(end)
  if (!a || !b) return []
  const out: string[] = []
  const last = Date.UTC(b.y, b.m - 1, b.d)
  for (let t = Date.UTC(a.y, a.m - 1, a.d); t <= last && out.length < limit; t += 86_400_000) {
    const x = new Date(t)
    out.push(ymdToString({ y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }))
  }
  return out
}

/** Date del selector de fechas (hora local) -> YYYY-MM-DD con sus partes locales. */
export function dateToYmd(date: Date): string {
  return ymdToString({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() })
}

/** YYYY-MM-DD -> Date local a mediodia (para el selector de fechas, sin desfase). */
export function ymdToLocalDate(value: string): Date | null {
  const p = parseYmd(value)
  return p ? new Date(p.y, p.m - 1, p.d, 12, 0, 0) : null
}

import { formatDayMonthYear } from '../utils/dates'
import type { Flight } from './uiData'
import type { UiEntry } from './reducer'
import { parseTrip, parseTrips } from './uiData'

const hhmm = (iso: string | null) => (iso && iso.includes('T') ? iso.split('T')[1].slice(0, 5) : '—')
const day = (iso: string | null) => (iso ? iso.split('T')[0] : '—')

/** tripId del ultimo componente trip/trips de la conversacion (en una lista, solo si hay exactamente un viaje). */
export function lastTripId(history: UiEntry[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]
    if (e.component === 'trip') {
      const t = parseTrip(e.data)
      if (t) return t.trip.tripId
    } else if (e.component === 'trips') {
      const list = parseTrips(e.data)
      if (list) return list.length === 1 ? list[0].tripId : null
    }
  }
  return null
}

/** Mensaje visible que el boton Reservar envia al asistente. */
export function composeReserveMessage(f: Flight, tripId: string | null): string {
  const where = tripId ? `en mi viaje ${tripId}` : 'en el viaje que corresponda; si hay varios, pregúntame cuál'
  return (
    `Registra una reserva SIMULADA del vuelo ${f.airline ?? ''} ${f.flightNumber} del ${day(f.departureTime)} ` +
    `(${f.origin ?? '—'}→${f.destination ?? '—'}, salida ${hhmm(f.departureTime)}, llegada ${hhmm(f.arrivalTime)}) ` +
    `por ${f.price ?? '—'} ${f.currency ?? ''} ${where}`
  )
    .replace(/\s+/g, ' ')
    .replace(' ,', ',')
    .trim()
}

export type TimeBand = 'any' | 'morning' | 'afternoon' | 'night'
export const BAND_OPTIONS: { label: string; value: TimeBand }[] = [
  { label: 'Cualquiera', value: 'any' },
  { label: 'Mañana', value: 'morning' },
  { label: 'Tarde', value: 'afternoon' },
  { label: 'Noche', value: 'night' },
]
const BAND_TEXT: Record<TimeBand, string> = { any: '', morning: 'por la mañana', afternoon: 'por la tarde', night: 'por la noche' }

export function composeFlightSearch(p: { origin: string; destination: string; date: string; band: TimeBand; passengers: number }): string {
  const people = p.passengers === 1 ? '1 persona' : `${p.passengers} personas`
  return `Busca vuelos de ${p.origin} a ${p.destination} el ${formatDayMonthYear(p.date)} ${BAND_TEXT[p.band]} para ${people}`.replace(/\s+/g, ' ').trim()
}

export function composeWeatherQuery(city: string, start: string, end: string): string {
  return start === end
    ? `¿Qué clima hará en ${city} el ${formatDayMonthYear(start)}?`
    : `¿Qué clima hará en ${city} del ${formatDayMonthYear(start)} al ${formatDayMonthYear(end)}?`
}

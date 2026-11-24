import type { ExchangeRates } from '../config/config'
import { DETAIL_KEYS, DETAIL_LABELS } from '../utils/validation'
import type { DayWeather, ItineraryDay, Reservation, Trip } from '../types'
import { computeBudget, moneyLabel, STATE_LABEL } from '../utils/budget'
import { formatDate, formatDateTime, formatDayMonthYear, todayBogota, weekdayEs } from '../utils/dates'
import { reservationDate, reservationSummary, STATUS_LABEL, TYPE_LABEL } from '../utils/trips'
import { pdfText, safeFileName } from './sanitize'

/** Modelos de documento: solo texto ya saneado, sin depender de jsPDF (se arman y se prueban sin cargarlo). */
export interface ActivityRow {
  time: string
  title: string
  place: string
}

export interface DayModel {
  heading: string
  weather: string
  activities: ActivityRow[]
}

export interface TripPdfModel {
  filename: string
  generatedLabel: string
  tripId: string
  title: string
  route: string
  dates: string
  travelers: string
  budget: string
  budgetSummary: string[]
  reservations: { head: string[]; rows: string[][] }
  days: DayModel[]
  hasItinerary: boolean
}

export interface VoucherPdfModel {
  filename: string
  generatedLabel: string
  heading: string
  status: string
  simulated: boolean
  provider: string
  details: [string, string][]
  price: string
  bookingUrl: string | null
  trip: [string, string][]
  day: DayModel | null
}

export const SIMULATED_NOTE = 'Reserva simulada: no se ha realizado ningún cobro'

const c = pdfText

export function generatedLabel(now: Date = new Date()): string {
  return c(`Generado el ${formatDayMonthYear(todayBogota(now))}`)
}

/** "viernes 4 de diciembre de 2026" (weekday calculado sobre Date.UTC; nunca new Date("YYYY-MM-DD")). */
export function dayHeading(date: string): string {
  const wd = weekdayEs(date)
  return c(wd ? `${wd} ${formatDayMonthYear(date)}` : date)
}

export function weatherLine(w?: DayWeather): string {
  if (!w) return 'Sin pronóstico'
  const parts: string[] = []
  if (w.tempMax !== undefined || w.tempMin !== undefined) parts.push(`máx ${w.tempMax ?? '-'}° / mín ${w.tempMin ?? '-'}°`)
  if (w.rainProbability !== undefined) parts.push(`${w.rainProbability} % de lluvia`)
  return c([w.condition ?? 'Clima', ...parts].join(' - '))
}

export function dayModel(d: ItineraryDay): DayModel {
  const items = [...d.items].sort((a, b) => a.time.localeCompare(b.time))
  return {
    heading: dayHeading(d.date),
    weather: weatherLine(d.weather),
    activities: items.map((it) => ({ time: c(it.time), title: c(it.title), place: c(it.location ?? '') })),
  }
}

function placeText(value: string): string {
  return c(value)
}

export function tripPdfModel(args: { trip: Trip; itinerary: { days: ItineraryDay[] } | null; reservations: Reservation[]; rates: ExchangeRates | null; now?: Date }): TripPdfModel {
  const { trip, itinerary, reservations, rates } = args
  const b = computeBudget(trip, reservations, rates)
  const pct = b.percent === null ? '-' : `${Math.round(b.percent)} %`
  const summary = [
    `Comprometido: ${moneyLabel(b.committed, b.currency, b.approximate)} (${pct}) - ${STATE_LABEL[b.state]}`,
    b.state === 'over' ? `Superaste el presupuesto en ${moneyLabel(b.overBy, b.currency, b.approximate)}` : `Disponible: ${moneyLabel(b.remaining, b.currency, b.approximate)}${b.perPerson !== null ? ` (${moneyLabel(b.perPerson, b.currency, b.approximate)} por persona)` : ''}`,
  ]
  if (b.unconverted.length > 0) summary.push(`Sin tasa para convertir (no incluido): ${b.unconverted.map((u) => moneyLabel(u.total, u.currency)).join(' + ')}`)
  summary.push(rates ? `${rates.label} - USD 1 = COP ${new Intl.NumberFormat('es-CO').format(rates.USD)} - al ${formatDayMonthYear(rates.asOf)}` : 'Sin tasa de referencia: los montos en otra moneda no se convierten.')

  return {
    filename: `TripPlanner_${safeFileName(trip.tripId)}.pdf`,
    generatedLabel: generatedLabel(args.now),
    tripId: c(trip.tripId),
    title: c(trip.title),
    route: `${placeText(trip.origin)} -> ${placeText(trip.destination)}`,
    dates: `${c(formatDayMonthYear(trip.startDate))} - ${c(formatDayMonthYear(trip.endDate))}`,
    travelers: String(trip.travelers),
    budget: moneyLabel(trip.budget, trip.currency),
    budgetSummary: summary.map(c),
    reservations: {
      head: ['ID', 'Tipo', 'Detalle', 'Fecha', 'Precio', 'Estado'],
      rows: reservations.map((r) => [c(r.resId), c(TYPE_LABEL[r.type]), c(reservationSummary(r)), c(formatDate(reservationDate(r))), moneyLabel(r.price, r.currency), c(STATUS_LABEL[r.status])]),
    },
    days: (itinerary?.days ?? []).map(dayModel),
    hasItinerary: !!itinerary,
  }
}

const DATETIME = new Set(['departureTime', 'arrivalTime'])
const DATE = new Set(['checkIn', 'checkOut', 'date'])

export function voucherPdfModel(args: { trip: Trip; reservation: Reservation; day: ItineraryDay | null; now?: Date }): VoucherPdfModel {
  const { trip, reservation: r, day } = args
  const keys = DETAIL_KEYS[r.type].filter((k) => r.details[k] && k !== 'bookingUrl')
  const url = r.details.bookingUrl
  return {
    filename: `Comprobante_${safeFileName(r.resId)}.pdf`,
    generatedLabel: generatedLabel(args.now),
    heading: c(`${TYPE_LABEL[r.type]} - ${r.resId}`),
    status: c(STATUS_LABEL[r.status]),
    simulated: r.status === 'SIMULADA',
    provider: c(r.provider),
    details: keys.map((k) => {
      const v = r.details[k]
      return [c(DETAIL_LABELS[k]), c(DATETIME.has(k) ? formatDateTime(v) : DATE.has(k) ? formatDate(v) : v)] as [string, string]
    }),
    price: moneyLabel(r.price, r.currency),
    bookingUrl: url ? c(url) : null,
    trip: [
      ['Título', c(trip.title)],
      ['Ruta', `${placeText(trip.origin)} -> ${placeText(trip.destination)}`],
      ['Fechas', `${c(formatDayMonthYear(trip.startDate))} - ${c(formatDayMonthYear(trip.endDate))}`],
      ['Viajeros', String(trip.travelers)],
    ],
    day: day ? dayModel(day) : null,
  }
}

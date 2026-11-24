import type { ItineraryDay, ReservationInput, ReservationType, TripInput } from '../types'
import { daysBetween, parseYmd } from './dates'
import { samePlace } from './place'

export type Errors = Record<string, string>

/** Refleja las reglas del backend (docs/03-api.md seccion 2). El backend manda: se muestra su message. */
export function validateTrip(v: Partial<TripInput>, today: string, opts: { checkStartFuture?: boolean } = {}): Errors {
  const e: Errors = {}
  const checkStart = opts.checkStartFuture ?? true
  const text = (k: 'title' | 'origin' | 'destination', min: number, max: number, label: string) => {
    const s = (v[k] ?? '').trim()
    if (s.length < min || s.length > max) e[k] = `${label} debe tener entre ${min} y ${max} caracteres.`
  }
  text('title', 1, 120, 'El título')
  text('origin', 2, 80, 'El origen')
  text('destination', 2, 80, 'El destino')
  if (!e.origin && !e.destination && samePlace(v.origin ?? '', v.destination ?? '')) e.destination = 'El destino debe ser distinto del origen.'
  const start = v.startDate ?? ''
  const end = v.endDate ?? ''
  if (!parseYmd(start)) e.startDate = 'Elige la fecha de inicio.'
  else if (checkStart && start < today) e.startDate = 'La fecha de inicio no puede ser anterior a hoy.'
  if (!parseYmd(end)) e.endDate = 'Elige la fecha de fin.'
  else if (parseYmd(start) && end < start) e.endDate = 'La fecha de fin debe ser igual o posterior al inicio.'
  else if (parseYmd(start) && daysBetween(start, end) + 1 > 90) e.endDate = 'El viaje no puede durar más de 90 días.'
  const t = v.travelers
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > 20) e.travelers = 'Los viajeros deben ser un entero entre 1 y 20.'
  const b = v.budget
  if (typeof b !== 'number' || !(b > 0) || b > 100_000_000) e.budget = 'El presupuesto debe ser mayor que 0 (máximo 100.000.000).'
  else if (Math.round(b * 100) !== b * 100 && Math.abs(Math.round(b * 100) - b * 100) > 1e-6) e.budget = 'El presupuesto admite máximo 2 decimales.'
  if (v.currency !== 'COP' && v.currency !== 'USD') e.currency = 'Elige la moneda.'
  if ((v.notes ?? '').length > 1000) e.notes = 'Las notas admiten máximo 1000 caracteres.'
  return e
}

const REQUIRED: Record<ReservationType, string[]> = {
  FLIGHT: ['flightNumber', 'origin', 'destination', 'departureTime'],
  HOTEL: ['hotelName', 'checkIn', 'checkOut'],
  ACTIVITY: ['activityName', 'date'],
}

export const DETAIL_LABELS: Record<string, string> = {
  airline: 'Aerolínea',
  flightNumber: 'Número de vuelo',
  departureTime: 'Salida',
  arrivalTime: 'Llegada',
  origin: 'Origen',
  destination: 'Destino',
  bookingUrl: 'Enlace de reserva',
  hotelName: 'Hotel',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  activityName: 'Actividad',
  date: 'Fecha',
  time: 'Hora',
}

export const DETAIL_KEYS: Record<ReservationType, string[]> = {
  FLIGHT: ['airline', 'flightNumber', 'departureTime', 'arrivalTime', 'origin', 'destination', 'bookingUrl'],
  HOTEL: ['hotelName', 'checkIn', 'checkOut'],
  ACTIVITY: ['activityName', 'date', 'time'],
}

export function validateReservation(v: Partial<ReservationInput>): Errors {
  const e: Errors = {}
  if (!v.type) e.type = 'Elige el tipo.'
  const provider = (v.provider ?? '').trim()
  if (provider.length < 1 || provider.length > 80) e.provider = 'El proveedor debe tener entre 1 y 80 caracteres.'
  if (typeof v.price !== 'number' || !(v.price >= 0) || v.price > 100_000_000) e.price = 'El precio debe ser 0 o mayor (máximo 100.000.000).'
  if (v.currency !== 'COP' && v.currency !== 'USD') e.currency = 'Elige la moneda.'
  const details = v.details ?? {}
  if (v.type) {
    for (const k of REQUIRED[v.type]) {
      if (!(details[k] ?? '').trim()) e[`details.${k}`] = `${DETAIL_LABELS[k]} es obligatorio.`
    }
  }
  for (const [k, val] of Object.entries(details)) {
    if (k === 'bookingUrl') {
      if (val && (!val.startsWith('https://') || /\s/.test(val))) e['details.bookingUrl'] = 'El enlace debe empezar por https:// y no llevar espacios.'
      else if (val.length > 2048) e['details.bookingUrl'] = 'El enlace admite máximo 2048 caracteres.'
    } else if (val.length > 200) {
      e[`details.${k}`] = `${DETAIL_LABELS[k] ?? k} admite máximo 200 caracteres.`
    }
  }
  return e
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateDay(day: ItineraryDay): Errors {
  const e: Errors = {}
  if (day.items.length > 30) e.items = 'Máximo 30 actividades por día.'
  day.items.forEach((it, i) => {
    if (!TIME.test(it.time)) e[`item.${i}.time`] = 'Hora inválida (HH:MM).'
    const t = it.title.trim()
    if (t.length < 1 || t.length > 120) e[`item.${i}.title`] = 'El título debe tener entre 1 y 120 caracteres.'
    if ((it.location ?? '').length > 120) e[`item.${i}.location`] = 'Máximo 120 caracteres.'
    if ((it.notes ?? '').length > 500) e[`item.${i}.notes`] = 'Máximo 500 caracteres.'
  })
  return e
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

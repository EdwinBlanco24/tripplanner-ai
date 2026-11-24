import type { Itinerary, ItineraryDay, Reservation, Trip } from '../types'

/** Lectura defensiva de los datos de los componentes ui (docs/04-tools-agentes.md 4.1). null = no cumple el esquema. */

export interface Flight {
  airline: string | null
  flightNumber: string
  origin: string | null
  destination: string | null
  departureTime: string | null
  arrivalTime: string | null
  durationMinutes: number | null
  stops: number | null
  price: number | null
  currency: string | null
  bookingUrl: string | null
}

export interface WeatherDayData {
  date: string
  weekday?: string
  tempMax: number | null
  tempMin: number | null
  condition: string | null
  rainProbability?: number
}

export interface WeatherData {
  location: string | null
  days: WeatherDayData[]
}

export interface ReservationsData {
  tripId?: string
  change: string
  reservations: Reservation[]
  resId?: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseFlights(data: unknown): Flight[] | null {
  if (!isObj(data) || !Array.isArray(data.flights)) return null
  const out: Flight[] = []
  for (const f of data.flights) {
    if (!isObj(f)) continue
    const flightNumber = str(f.flightNumber)
    if (!flightNumber) continue
    out.push({
      airline: str(f.airline),
      flightNumber,
      origin: str(f.origin),
      destination: str(f.destination),
      departureTime: str(f.departureTime),
      arrivalTime: str(f.arrivalTime),
      durationMinutes: num(f.durationMinutes),
      stops: num(f.stops),
      price: num(f.price),
      currency: str(f.currency),
      bookingUrl: str(f.bookingUrl),
    })
  }
  return out.length ? out : null
}

export function parseWeather(data: unknown): WeatherData | null {
  const w = isObj(data) ? data.weather : null
  if (!isObj(w) || !Array.isArray(w.days)) return null
  const days: WeatherDayData[] = []
  for (const d of w.days) {
    if (!isObj(d) || !str(d.date)) continue
    const rain = num(d.rainProbability)
    days.push({
      date: d.date as string,
      ...(str(d.weekday) ? { weekday: d.weekday as string } : {}),
      tempMax: num(d.tempMax),
      tempMin: num(d.tempMin),
      condition: str(d.condition),
      ...(rain !== null ? { rainProbability: rain } : {}),
    })
  }
  return days.length ? { location: str(w.location), days } : null
}

function looksLikeTrip(v: unknown): v is Trip {
  return isObj(v) && typeof v.tripId === 'string' && typeof v.title === 'string' && typeof v.origin === 'string' && typeof v.destination === 'string'
}

export function parseTrip(data: unknown): { trip: Trip; itinerary?: Itinerary | null; reservations?: Reservation[] } | null {
  if (!isObj(data) || !looksLikeTrip(data.trip)) return null
  return { trip: data.trip, itinerary: isObj(data.itinerary) ? (data.itinerary as unknown as Itinerary) : null, reservations: Array.isArray(data.reservations) ? (data.reservations as Reservation[]) : undefined }
}

export function parseTrips(data: unknown): Trip[] | null {
  if (!isObj(data) || !Array.isArray(data.trips)) return null
  return data.trips.filter(looksLikeTrip)
}

export function parseItinerary(data: unknown): { tripId?: string; days: ItineraryDay[] } | null {
  if (!isObj(data) || !Array.isArray(data.days)) return null
  const days = data.days.filter((d): d is ItineraryDay => isObj(d) && typeof d.date === 'string' && Array.isArray(d.items))
  return { tripId: str(data.tripId) ?? undefined, days }
}

export function parseReservations(data: unknown): ReservationsData | null {
  if (!isObj(data) || !Array.isArray(data.reservations)) return null
  const reservations = data.reservations.filter((r): r is Reservation => isObj(r) && typeof r.resId === 'string' && typeof r.tripId === 'string')
  return { tripId: str(data.tripId) ?? undefined, change: str(data.change) ?? 'listed', reservations, resId: str(data.resId) ?? undefined }
}

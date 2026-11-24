import type { Reservation, ReservationStatus, Trip } from '../types'

/** Viaje futuro mas cercano por startDate: PLANNED con startDate >= hoy. */
export function selectNextTrip(trips: Trip[], today: string): Trip | null {
  const future = trips.filter((t) => t.status === 'PLANNED' && t.startDate >= today)
  if (future.length === 0) return null
  return [...future].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.tripId.localeCompare(b.tripId))[0]
}

export function countByStatus(reservations: Reservation[]): Record<ReservationStatus, number> {
  const out: Record<ReservationStatus, number> = { SIMULADA: 0, PENDIENTE: 0, CONFIRMADA: 0 }
  for (const r of reservations) out[r.status] += 1
  return out
}

export function nextStatus(status: ReservationStatus): ReservationStatus | null {
  if (status === 'SIMULADA') return 'PENDIENTE'
  if (status === 'PENDIENTE') return 'CONFIRMADA'
  return null
}

export function reservationSummary(r: Reservation): string {
  const d = r.details
  if (r.type === 'FLIGHT') return `${d.airline ?? r.provider} ${d.flightNumber ?? ''} · ${d.origin ?? ''} → ${d.destination ?? ''}`.replace(/\s+/g, ' ').trim()
  if (r.type === 'HOTEL') return d.hotelName ?? r.provider
  return d.activityName ?? r.provider
}

export function reservationDate(r: Reservation): string {
  const d = r.details
  if (r.type === 'FLIGHT') return (d.departureTime ?? '').split('T')[0]
  if (r.type === 'HOTEL') return d.checkIn ?? ''
  return d.date ?? ''
}

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  SIMULADA: 'Simulada',
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
}

export const TYPE_LABEL = { FLIGHT: 'Vuelo', HOTEL: 'Hotel', ACTIVITY: 'Actividad' } as const

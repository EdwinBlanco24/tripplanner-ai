import { describe, expect, it } from 'vitest'
import type { Reservation, Trip } from '../types'
import { countByStatus, nextStatus, selectNextTrip } from '../utils/trips'

const trip = (id: string, startDate: string, status: Trip['status'] = 'PLANNED'): Trip => ({
  tripId: id,
  title: id,
  origin: 'A',
  destination: 'B',
  startDate,
  endDate: startDate,
  travelers: 1,
  budget: 1,
  currency: 'COP',
  createdBy: 'user',
  status,
  createdAt: '',
  updatedAt: '',
})

describe('selectNextTrip', () => {
  const today = '2026-12-01'
  it('elige el viaje futuro mas cercano', () => {
    const t = selectNextTrip([trip('c', '2027-02-01'), trip('a', '2026-12-10'), trip('b', '2026-12-20')], today)
    expect(t?.tripId).toBe('a')
  })
  it('incluye uno que empieza hoy y descarta pasados y cancelados', () => {
    expect(selectNextTrip([trip('p', '2026-11-30'), trip('x', '2026-12-02', 'CANCELLED'), trip('h', '2026-12-01')], today)?.tripId).toBe('h')
    expect(selectNextTrip([trip('p', '2026-11-30'), trip('x', '2026-12-02', 'CANCELLED')], today)).toBeNull()
  })
  it('lista vacia', () => expect(selectNextTrip([], today)).toBeNull())
})

describe('reservas', () => {
  it('cuenta por estado y avanza el estado', () => {
    const r = (status: Reservation['status']) => ({ status }) as Reservation
    expect(countByStatus([r('SIMULADA'), r('SIMULADA'), r('CONFIRMADA')])).toEqual({ SIMULADA: 2, PENDIENTE: 0, CONFIRMADA: 1 })
    expect(nextStatus('SIMULADA')).toBe('PENDIENTE')
    expect(nextStatus('PENDIENTE')).toBe('CONFIRMADA')
    expect(nextStatus('CONFIRMADA')).toBeNull()
  })
})

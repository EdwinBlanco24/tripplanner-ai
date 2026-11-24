import { describe, expect, it } from 'vitest'
import { validateReservation, validateTrip } from '../utils/validation'

const ok = {
  title: 'Viaje',
  origin: 'Bogotá',
  destination: 'Cartagena',
  startDate: '2026-12-04',
  endDate: '2026-12-07',
  travelers: 2,
  budget: 3500000,
  currency: 'COP' as const,
}

describe('validateTrip', () => {
  it('acepta un viaje valido', () => expect(validateTrip(ok, '2026-12-01')).toEqual({}))
  it('inicio pasado, fin anterior, viajeros y presupuesto', () => {
    const e = validateTrip({ ...ok, startDate: '2026-11-01', endDate: '2026-10-01', travelers: 0, budget: 0 }, '2026-12-01')
    expect(e.startDate).toBeTruthy()
    expect(e.endDate).toBeTruthy()
    expect(e.travelers).toBeTruthy()
    expect(e.budget).toBeTruthy()
  })
  it('al editar sin cambiar el inicio no exige fecha futura', () => {
    expect(validateTrip({ ...ok, startDate: '2026-11-01', endDate: '2026-11-03' }, '2026-12-01', { checkStartFuture: false })).toEqual({})
  })
  it('mas de 90 dias', () => expect(validateTrip({ ...ok, endDate: '2027-04-01' }, '2026-12-01').endDate).toMatch(/90/))
})

describe('validateReservation', () => {
  const flight = {
    type: 'FLIGHT' as const,
    status: 'SIMULADA' as const,
    provider: 'Avianca',
    price: 100,
    currency: 'COP' as const,
    details: { flightNumber: 'AV1', origin: 'BOG', destination: 'CTG', departureTime: '2026-12-04T07:15' },
  }
  it('vuelo valido', () => expect(validateReservation(flight)).toEqual({}))
  it('bookingUrl solo https y sin espacios', () => {
    expect(validateReservation({ ...flight, details: { ...flight.details, bookingUrl: 'http://x.com' } })['details.bookingUrl']).toBeTruthy()
    expect(validateReservation({ ...flight, details: { ...flight.details, bookingUrl: 'https://x.com/a b' } })['details.bookingUrl']).toBeTruthy()
    expect(validateReservation({ ...flight, details: { ...flight.details, bookingUrl: 'https://x.com/a' } })).toEqual({})
  })
  it('exige los campos obligatorios del tipo', () => {
    const e = validateReservation({ ...flight, details: {} })
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['details.flightNumber', 'details.origin', 'details.destination', 'details.departureTime']))
  })
})

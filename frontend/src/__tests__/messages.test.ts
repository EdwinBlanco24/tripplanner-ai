import { describe, expect, it } from 'vitest'
import { composeFlightSearch, composeReserveMessage, composeWeatherQuery, lastTripId } from '../agent/messages'
import type { UiEntry } from '../agent/reducer'
import type { Flight } from '../agent/uiData'
import { validateFlightSearch, validateWeatherQuery, forecastHorizon } from '../utils/searchValidation'
import { addDays, formatDayMonthYear, weekdayEs } from '../utils/dates'

const FLIGHT: Flight = {
  airline: 'Wingo', flightNumber: 'P57216', origin: 'BOG', destination: 'CTG',
  departureTime: '2026-12-04T06:35', arrivalTime: '2026-12-04T08:07', durationMinutes: 92, stops: 0, price: 398, currency: 'USD', bookingUrl: null,
}
const entry = (seq: number, component: string, data: unknown): UiEntry => ({ seq, component, data })
const trip = (id: string) => ({ trip: { tripId: id, title: 't', origin: 'a', destination: 'b' } })

describe('mensaje de Reservar', () => {
  it('con tripId', () => {
    expect(composeReserveMessage(FLIGHT, 'TRP-0123abcd')).toBe(
      'Registra una reserva SIMULADA del vuelo Wingo P57216 del 2026-12-04 (BOG→CTG, salida 06:35, llegada 08:07) por 398 USD en mi viaje TRP-0123abcd',
    )
  })
  it('sin tripId pide aclarar', () => {
    const m = composeReserveMessage(FLIGHT, null)
    expect(m).toMatch(/en el viaje que corresponda; si hay varios, pregúntame cuál$/)
    expect(m).not.toMatch(/TRP-/)
  })
})

describe('lastTripId', () => {
  it('toma el ultimo trip de la conversacion', () => {
    expect(lastTripId([entry(1, 'trip', trip('TRP-1')), entry(2, 'weather', {}), entry(3, 'trip', trip('TRP-2'))])).toBe('TRP-2')
  })
  it('en una lista solo si hay exactamente un viaje', () => {
    expect(lastTripId([entry(1, 'trips', { trips: [trip('TRP-9').trip] })])).toBe('TRP-9')
    expect(lastTripId([entry(1, 'trips', { trips: [trip('TRP-1').trip, trip('TRP-2').trip] })])).toBeNull()
  })
  it('sin viajes: null', () => expect(lastTripId([entry(1, 'flights', {})])).toBeNull())
})

describe('mensajes de Vuelos y Clima', () => {
  it('busqueda de vuelos', () => {
    expect(composeFlightSearch({ origin: 'Bogotá, Colombia', destination: 'Cartagena, Colombia', date: '2026-12-04', band: 'morning', passengers: 3 })).toBe(
      'Busca vuelos de Bogotá, Colombia a Cartagena, Colombia el 4 de diciembre de 2026 por la mañana para 3 personas',
    )
    expect(composeFlightSearch({ origin: 'A', destination: 'B', date: '2026-12-04', band: 'any', passengers: 1 })).toBe('Busca vuelos de A a B el 4 de diciembre de 2026 para 1 persona')
  })
  it('consulta de clima', () => {
    expect(composeWeatherQuery('Cartagena, Colombia', '2026-12-04', '2026-12-07')).toBe('¿Qué clima hará en Cartagena, Colombia del 4 de diciembre de 2026 al 7 de diciembre de 2026?')
    expect(composeWeatherQuery('Cartagena', '2026-12-04', '2026-12-04')).toBe('¿Qué clima hará en Cartagena el 4 de diciembre de 2026?')
  })
})

describe('dia de la semana en el cliente (sin new Date("YYYY-MM-DD"))', () => {
  it('fechas conocidas', () => {
    expect(weekdayEs('2026-12-04')).toBe('viernes')
    expect(weekdayEs('2026-12-07')).toBe('lunes')
    expect(weekdayEs('2026-12-31')).toBe('jueves')
    expect(weekdayEs('2027-01-01')).toBe('viernes')
  })
  it('invalidas: null', () => {
    expect(weekdayEs('2026-02-30')).toBeNull()
    expect(weekdayEs(null)).toBeNull()
    expect(weekdayEs('04/12/2026')).toBeNull()
  })
  it('sin desfase en ninguna zona horaria del equipo', () => {
    const tz = process.env.TZ
    for (const zone of ['America/Bogota', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      process.env.TZ = zone
      expect(weekdayEs('2026-12-04')).toBe('viernes')
    }
    process.env.TZ = tz
  })
  it('helpers de fecha', () => {
    expect(formatDayMonthYear('2026-12-04')).toBe('4 de diciembre de 2026')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })
})

describe('validacion de Vuelos', () => {
  const ok = { origin: 'Bogotá, Colombia', destination: 'Cartagena, Colombia', date: '2026-12-04', passengers: 2 }
  it('valido', () => expect(validateFlightSearch(ok, '2026-11-23')).toEqual({}))
  it('campos obligatorios, fecha pasada y pasajeros', () => {
    const e = validateFlightSearch({ origin: '', destination: ' ', date: '', passengers: 0 }, '2026-11-23')
    expect(Object.keys(e).sort()).toEqual(['date', 'destination', 'origin', 'passengers'])
    expect(validateFlightSearch({ ...ok, date: '2026-11-22' }, '2026-11-23').date).toMatch(/anterior a hoy/)
    expect(validateFlightSearch({ ...ok, passengers: 10 }, '2026-11-23').passengers).toBeTruthy()
    expect(validateFlightSearch({ ...ok, passengers: 9 }, '2026-11-23')).toEqual({})
  })
  it('origen distinto de destino', () => {
    expect(validateFlightSearch({ ...ok, destination: 'bogota, colombia' }, '2026-11-23').destination).toBe('El destino debe ser distinto del origen.')
  })
})

describe('validacion de Clima', () => {
  const today = '2026-11-23'
  it('horizonte = hoy + 15 dias', () => expect(forecastHorizon(today)).toBe('2026-12-08'))
  it('valido', () => expect(validateWeatherQuery({ city: 'Cartagena', start: '2026-11-26', end: '2026-11-28' }, today)).toEqual({}))
  it('exactamente 16 dias desde hoy es valido; uno mas no', () => {
    expect(validateWeatherQuery({ city: 'Quito', start: today, end: '2026-12-08' }, today)).toEqual({})
    expect(validateWeatherQuery({ city: 'Quito', start: today, end: '2026-12-09' }, today).end).toMatch(/hasta el 2026-12-08/)
  })
  it('inicio pasado, fin anterior e informacion faltante', () => {
    expect(validateWeatherQuery({ city: 'Quito', start: '2026-11-20', end: '2026-11-24' }, today).start).toBeTruthy()
    expect(validateWeatherQuery({ city: 'Quito', start: '2026-11-26', end: '2026-11-25' }, today).end).toBeTruthy()
    expect(Object.keys(validateWeatherQuery({ city: '', start: '', end: '' }, today)).sort()).toEqual(['city', 'end', 'start'])
  })
})

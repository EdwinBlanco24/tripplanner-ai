import { addDays, daysBetween, parseYmd } from './dates'
import { samePlace } from './place'
import type { Errors } from './validation'

export const MAX_FORECAST_DAYS = 16

export function validateFlightSearch(v: { origin: string; destination: string; date: string; passengers: number | null }, today: string): Errors {
  const e: Errors = {}
  const origin = v.origin.trim()
  const destination = v.destination.trim()
  if (origin.length < 2) e.origin = 'Indica la ciudad de origen.'
  if (destination.length < 2) e.destination = 'Indica la ciudad de destino.'
  if (!e.origin && !e.destination && samePlace(origin, destination)) e.destination = 'El destino debe ser distinto del origen.'
  if (!parseYmd(v.date)) e.date = 'Elige la fecha del vuelo.'
  else if (v.date < today) e.date = 'La fecha no puede ser anterior a hoy.'
  const n = v.passengers
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 9) e.passengers = 'Los pasajeros deben ser entre 1 y 9.'
  return e
}

/** El pronostico cubre desde hoy hasta 15 dias despues (16 dias contando hoy). */
export function forecastHorizon(today: string): string {
  return addDays(today, MAX_FORECAST_DAYS - 1)
}

export function validateWeatherQuery(v: { city: string; start: string; end: string }, today: string): Errors {
  const e: Errors = {}
  if (v.city.trim().length < 2) e.city = 'Indica la ciudad.'
  const okStart = !!parseYmd(v.start)
  const okEnd = !!parseYmd(v.end)
  if (!okStart) e.start = 'Elige la fecha de inicio.'
  else if (v.start < today) e.start = 'La fecha de inicio no puede ser anterior a hoy.'
  if (!okEnd) e.end = 'Elige la fecha de fin.'
  else if (okStart && v.end < v.start) e.end = 'La fecha de fin debe ser igual o posterior al inicio.'
  else if (v.end > forecastHorizon(today)) e.end = `El pronóstico solo llega hasta el ${forecastHorizon(today)} (16 días desde hoy).`
  else if (okStart && daysBetween(v.start, v.end) + 1 > MAX_FORECAST_DAYS) e.end = 'El rango no puede superar 16 días.'
  return e
}

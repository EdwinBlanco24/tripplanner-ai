import type { ExchangeRates } from '../config/config'
import type { Currency, ReservationType } from '../types'

export type BudgetState = 'ok' | 'warning' | 'over'

/** Limites del estado: por debajo de 80 % esta bien; de 80 a 100 % es advertencia; mas de 100 % excede. */
export const WARNING_FROM = 80
export const OVER_FROM = 100

export interface BudgetTrip {
  budget: number
  currency: Currency
  travelers: number
}

export interface BudgetReservation {
  price: number
  currency: Currency
  type: ReservationType
  status: string
}

export interface CurrencyTotal {
  currency: Currency
  total: number
}

export interface TypeBreakdown {
  type: ReservationType
  count: number
  /** Totales en la moneda original de las reservas (sin convertir). */
  originals: CurrencyTotal[]
  /** Aporte en la moneda del viaje (solo lo convertible). */
  converted: number
}

export interface BudgetSummary {
  currency: Currency
  budget: number
  /** Comprometido en la moneda del viaje (solo lo convertible). */
  committed: number
  /** true si algun monto se convirtio con la tasa de referencia (el total es aproximado). */
  approximate: boolean
  /** Montos que no se pudieron convertir (moneda sin tasa), aparte. */
  unconverted: CurrencyTotal[]
  byType: TypeBreakdown[]
  /** Porcentaje comprometido (sin redondear), o null si el presupuesto no es positivo. */
  percent: number | null
  /** Disponible = presupuesto - comprometido (negativo si se excedio). */
  remaining: number
  /** Disponible por persona (0 si no hay disponible); null si no hay viajeros validos. */
  perPerson: number | null
  state: BudgetState
  /** Cuanto se excedio (>0 solo en estado over). */
  overBy: number
  reservationCount: number
}

const TYPES: ReservationType[] = ['FLIGHT', 'HOTEL', 'ACTIVITY']

/** COP sin decimales; USD con 2. */
export function roundMoney(value: number, currency: Currency): number {
  const f = currency === 'COP' ? 1 : 100
  return Math.round((value + Number.EPSILON) * f) / f
}

/** Convierte un monto a la moneda del viaje; null si no hay tasa para hacerlo. */
export function convert(amount: number, from: Currency, to: Currency, rates: ExchangeRates | null): number | null {
  if (from === to) return amount
  if (!rates || !(rates.USD > 0)) return null
  if (from === 'USD' && to === 'COP') return amount * rates.USD
  if (from === 'COP' && to === 'USD') return amount / rates.USD
  return null
}

function addTotal(list: CurrencyTotal[], currency: Currency, amount: number) {
  const row = list.find((r) => r.currency === currency)
  if (row) row.total += amount
  else list.push({ currency, total: amount })
}

export function computeBudget(trip: BudgetTrip, reservations: BudgetReservation[], rates: ExchangeRates | null): BudgetSummary {
  const cur = trip.currency
  let committedRaw = 0
  let approximate = false
  const unconverted: CurrencyTotal[] = []
  const byType: TypeBreakdown[] = TYPES.map((type) => ({ type, count: 0, originals: [], converted: 0 }))

  for (const r of reservations) {
    const price = Number.isFinite(r.price) ? r.price : 0
    const row = byType.find((b) => b.type === r.type)
    if (row) {
      row.count += 1
      addTotal(row.originals, r.currency, price)
    }
    const conv = convert(price, r.currency, cur, rates)
    if (conv === null) {
      addTotal(unconverted, r.currency, price)
      continue
    }
    if (r.currency !== cur) approximate = true
    committedRaw += conv
    if (row) row.converted += conv
  }

  const budget = Number.isFinite(trip.budget) ? trip.budget : 0
  const percent = budget > 0 ? (committedRaw / budget) * 100 : null
  const remainingRaw = budget - committedRaw
  const state: BudgetState = percent === null ? (committedRaw > 0 ? 'over' : 'ok') : percent > OVER_FROM ? 'over' : percent >= WARNING_FROM ? 'warning' : 'ok'
  const people = Number.isFinite(trip.travelers) ? Math.floor(trip.travelers) : 0

  return {
    currency: cur,
    budget: roundMoney(budget, cur),
    committed: roundMoney(committedRaw, cur),
    approximate,
    unconverted: unconverted.map((u) => ({ ...u, total: roundMoney(u.total, u.currency) })),
    byType: byType.map((b) => ({ ...b, originals: b.originals.map((o) => ({ ...o, total: roundMoney(o.total, o.currency) })), converted: roundMoney(b.converted, cur) })),
    percent,
    remaining: roundMoney(remainingRaw, cur),
    perPerson: people >= 1 ? roundMoney(Math.max(remainingRaw, 0) / people, cur) : null,
    state,
    overBy: remainingRaw < 0 ? roundMoney(-remainingRaw, cur) : 0,
    reservationCount: reservations.length,
  }
}

/** "COP 5.000.000" (COP sin decimales) o "USD 1.250,50"; con approx antepone "≈ ". */
export function moneyLabel(amount: number, currency: Currency | string, approx = false): string {
  const digits = currency === 'COP' ? 0 : 2
  const n = new Intl.NumberFormat('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)
  return `${approx ? '≈ ' : ''}${currency} ${n}`
}

export const STATE_LABEL: Record<BudgetState, string> = {
  ok: 'Dentro del presupuesto',
  warning: 'Cerca del límite',
  over: 'Sobre el presupuesto',
}

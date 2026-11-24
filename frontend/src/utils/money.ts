import type { Currency } from '../types'

export function formatMoney(amount: number, currency: Currency | string): string {
  const digits = currency === 'COP' ? 0 : 2
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

/** Suma por moneda, sin convertir entre monedas. */
export function totalsByCurrency(rows: { price: number; currency: Currency }[]): { currency: Currency; total: number }[] {
  const map = new Map<Currency, number>()
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.price)
  return [...map.entries()].map(([currency, total]) => ({ currency, total }))
}

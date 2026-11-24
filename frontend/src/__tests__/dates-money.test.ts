import { describe, expect, it } from 'vitest'
import { daysBetween, eachDay, formatDate, formatDateTime, parseYmd, todayBogota } from '../utils/dates'
import { formatMoney, totalsByCurrency } from '../utils/money'

describe('fechas sin desfase', () => {
  it('muestra el mismo dia aunque el proceso este en una zona al oeste de UTC', () => {
    const original = process.env.TZ
    process.env.TZ = 'America/Bogota'
    try {
      expect(formatDate('2026-12-04')).toContain('dic')
      expect(formatDate('2026-12-04')).toMatch(/^4\b/)
      expect(formatDate('2026-12-04')).toContain('2026')
      expect(formatDate('2026-01-01')).toContain('ene')
      expect(formatDate('2026-01-01')).toMatch(/^1\b/)
    } finally {
      process.env.TZ = original
    }
  })
  it('rechaza fechas imposibles', () => {
    expect(parseYmd('2026-02-30')).toBeNull()
    expect(parseYmd('2026-13-01')).toBeNull()
    expect(formatDate('basura')).toBe('basura')
    expect(formatDate(undefined)).toBe('—')
  })
  it('formatea fecha y hora sin zona sin convertir', () => {
    expect(formatDateTime('2026-12-04T07:15')).toContain('07:15')
    expect(formatDateTime('2026-12-04T07:15')).toMatch(/^4\b/)
  })
  it('hoy en Bogota: a las 03:00 UTC todavia es el dia anterior', () => {
    expect(todayBogota(new Date('2026-12-05T03:00:00Z'))).toBe('2026-12-04')
    expect(todayBogota(new Date('2026-12-05T06:00:00Z'))).toBe('2026-12-05')
  })
  it('daysBetween y eachDay', () => {
    expect(daysBetween('2026-12-04', '2026-12-07')).toBe(3)
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(eachDay('2026-01-01', '2026-12-31', 30)).toHaveLength(30)
  })
})

describe('moneda', () => {
  it('COP sin decimales con separador es-CO', () => {
    const s = formatMoney(3500000, 'COP')
    expect(s).toContain('3.500.000')
    expect(s).not.toContain(',')
  })
  it('USD con 2 decimales', () => {
    expect(formatMoney(1234.5, 'USD')).toContain('1.234,50')
  })
  it('suma por moneda sin convertir', () => {
    const t = totalsByCurrency([
      { price: 100, currency: 'COP' },
      { price: 50, currency: 'COP' },
      { price: 10, currency: 'USD' },
    ])
    expect(t).toEqual([
      { currency: 'COP', total: 150 },
      { currency: 'USD', total: 10 },
    ])
  })
})

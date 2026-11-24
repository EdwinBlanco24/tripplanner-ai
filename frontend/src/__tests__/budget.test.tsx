import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BudgetPanel } from '../components/BudgetPanel'
import { getExchangeRates, parseConfig, parseExchangeRates, setConfig, type ExchangeRates } from '../config/config'
import { computeBudget, convert, moneyLabel, roundMoney, type BudgetReservation } from '../utils/budget'

const RATES: ExchangeRates = { base: 'COP', USD: 3300, asOf: '2026-11-24', label: 'Tasa de referencia aproximada (TRM nov. 2026)' }
const TRIP = { budget: 5_000_000, currency: 'COP' as const, travelers: 3 }
const res = (type: BudgetReservation['type'], price: number, currency: 'COP' | 'USD' = 'COP'): BudgetReservation => ({ type, price, currency, status: 'SIMULADA' })

describe('computeBudget', () => {
  it('sin reservas: 0 comprometido, todo disponible, estado ok', () => {
    const s = computeBudget(TRIP, [], RATES)
    expect(s).toMatchObject({ committed: 0, remaining: 5_000_000, percent: 0, state: 'ok', overBy: 0, approximate: false, reservationCount: 0 })
    expect(s.perPerson).toBe(1_666_667)
    expect(s.byType.every((b) => b.count === 0)).toBe(true)
  })

  it('mezcla USD y COP con la tasa de referencia, desglose por tipo y totales originales', () => {
    const s = computeBudget(TRIP, [res('FLIGHT', 398, 'USD'), res('FLIGHT', 600_000), res('HOTEL', 800_000), res('ACTIVITY', 120_000)], RATES)
    expect(s.committed).toBe(398 * 3300 + 600_000 + 800_000 + 120_000) // 2.833.400
    expect(s.approximate).toBe(true)
    const flight = s.byType.find((b) => b.type === 'FLIGHT')!
    expect(flight.count).toBe(2)
    expect(flight.originals).toEqual([{ currency: 'USD', total: 398 }, { currency: 'COP', total: 600_000 }])
    expect(flight.converted).toBe(398 * 3300 + 600_000)
    expect(s.byType.find((b) => b.type === 'HOTEL')).toMatchObject({ count: 1, converted: 800_000 })
    expect(s.remaining).toBe(5_000_000 - 2_833_400)
    expect(s.perPerson).toBe(Math.round((5_000_000 - 2_833_400) / 3))
    expect(s.state).toBe('ok')
  })

  it('solo COP no es aproximado', () => {
    expect(computeBudget(TRIP, [res('HOTEL', 1_000_000)], RATES).approximate).toBe(false)
  })

  it('sin tasa: lo que esta en otra moneda va aparte como sin convertir y no suma', () => {
    const s = computeBudget(TRIP, [res('FLIGHT', 398, 'USD'), res('HOTEL', 1_000_000)], null)
    expect(s.committed).toBe(1_000_000)
    expect(s.unconverted).toEqual([{ currency: 'USD', total: 398 }])
    expect(s.approximate).toBe(false)
    expect(s.byType.find((b) => b.type === 'FLIGHT')).toMatchObject({ count: 1, converted: 0, originals: [{ currency: 'USD', total: 398 }] })
  })

  it('viaje en USD: convierte los COP a USD con 2 decimales', () => {
    const s = computeBudget({ budget: 1000, currency: 'USD', travelers: 2 }, [res('HOTEL', 1_650_000, 'COP'), res('FLIGHT', 100, 'USD')], RATES)
    expect(s.committed).toBe(600)
    expect(s.percent).toBe(60)
    expect(s.remaining).toBe(400)
    expect(s.perPerson).toBe(200)
  })

  it('estados: <80 ok, 80 a 100 advertencia, >100 excedido', () => {
    const at = (committed: number) => computeBudget(TRIP, [res('HOTEL', committed)], RATES)
    expect(at(3_999_999).state).toBe('ok')
    expect(at(4_000_000).state).toBe('warning')
    expect(at(5_000_000).state).toBe('warning')
    expect(at(5_000_001).state).toBe('over')
  })

  it('sobre el presupuesto: overBy, disponible negativo y por persona 0', () => {
    const s = computeBudget(TRIP, [res('HOTEL', 6_200_000)], RATES)
    expect(s).toMatchObject({ state: 'over', overBy: 1_200_000, remaining: -1_200_000, perPerson: 0 })
    expect(s.percent).toBeCloseTo(124)
  })

  it('0 viajeros (o invalido): por persona es null, sin dividir por cero', () => {
    expect(computeBudget({ ...TRIP, travelers: 0 }, [], RATES).perPerson).toBeNull()
    expect(computeBudget({ ...TRIP, travelers: Number.NaN }, [], RATES).perPerson).toBeNull()
    expect(computeBudget({ ...TRIP, travelers: -2 }, [], RATES).perPerson).toBeNull()
  })

  it('presupuesto 0: sin porcentaje; con gasto es excedido, sin gasto ok', () => {
    expect(computeBudget({ ...TRIP, budget: 0 }, [res('HOTEL', 10)], RATES)).toMatchObject({ percent: null, state: 'over' })
    expect(computeBudget({ ...TRIP, budget: 0 }, [], RATES)).toMatchObject({ percent: null, state: 'ok' })
  })

  it('redondeo: COP sin decimales, USD con dos', () => {
    expect(roundMoney(1234.5, 'COP')).toBe(1235)
    expect(roundMoney(12.345, 'USD')).toBe(12.35)
    expect(computeBudget(TRIP, [res('FLIGHT', 100.5, 'USD')], RATES).committed).toBe(331_650)
  })

  it('convert: misma moneda no necesita tasa; otra sin tasa es null', () => {
    expect(convert(10, 'COP', 'COP', null)).toBe(10)
    expect(convert(10, 'USD', 'COP', null)).toBeNull()
    expect(convert(10, 'USD', 'COP', { ...RATES, USD: 0 })).toBeNull()
    expect(convert(3300, 'COP', 'USD', RATES)).toBe(1)
  })

  it('precio no numerico se trata como 0', () => {
    expect(computeBudget(TRIP, [res('HOTEL', Number.NaN)], RATES).committed).toBe(0)
  })
})

describe('moneyLabel', () => {
  it('COP 5.000.000 y aproximado', () => {
    expect(moneyLabel(5_000_000, 'COP')).toBe('COP 5.000.000')
    expect(moneyLabel(2_833_400, 'COP', true)).toBe('≈ COP 2.833.400')
    expect(moneyLabel(398, 'USD')).toBe('USD 398,00')
  })
})

describe('tasa en la configuracion', () => {
  const base = { apiUrl: 'https://a.example.com', region: 'r', userPoolId: 'p', userPoolClientId: 'c', orchestratorRuntimeArn: 'arn' }
  it('se lee y valida; si falta o es invalida es null y la configuracion sigue valida', () => {
    expect(parseConfig({ ...base, exchangeRates: RATES }).exchangeRates).toEqual(RATES)
    for (const bad of [undefined, null, 'x', { ...RATES, USD: 0 }, { ...RATES, USD: '3300' }, { ...RATES, base: 'USD' }, { ...RATES, asOf: '24/11/2026' }, { ...RATES, label: '' }]) {
      expect(parseConfig({ ...base, exchangeRates: bad }).exchangeRates).toBeNull()
    }
    expect(parseExchangeRates(RATES)).toEqual(RATES)
  })
  it('getExchangeRates usa la configuracion cargada', () => {
    setConfig(parseConfig({ ...base, exchangeRates: RATES }))
    expect(getExchangeRates()).toEqual(RATES)
    setConfig(parseConfig(base))
    expect(getExchangeRates()).toBeNull()
  })
})

describe('BudgetPanel', () => {
  it('detalle: presupuesto, comprometido, desglose, disponible por persona y leyenda de la tasa', () => {
    render(<BudgetPanel trip={TRIP} reservations={[res('FLIGHT', 398, 'USD'), res('HOTEL', 800_000)]} rates={RATES} />)
    expect(screen.getByText('COP 5.000.000')).toBeInTheDocument()
    expect(screen.getByText('≈ COP 2.113.400')).toBeInTheDocument()
    expect(screen.getByText(/Vuelo/)).toBeInTheDocument()
    expect(screen.getByText(/por persona/)).toBeInTheDocument()
    expect(screen.getByText(/Tasa de referencia aproximada \(TRM nov\. 2026\) · USD 1 = COP 3\.300 · al 24 de nov de 2026/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Presupuesto comprometido' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('Dentro del presupuesto')).toBeInTheDocument() // el estado tambien va en texto
  })

  it('advertencia en ambar con texto', () => {
    const { container } = render(<BudgetPanel trip={TRIP} reservations={[res('HOTEL', 4_500_000)]} rates={RATES} />)
    expect(container.querySelector('.budget')).toHaveAttribute('data-state', 'warning')
    expect(screen.getByText('Cerca del límite')).toBeInTheDocument()
  })

  it('excedido: mensaje y barra al 100 %', () => {
    render(<BudgetPanel trip={TRIP} reservations={[res('HOTEL', 6_200_000)]} rates={RATES} />)
    expect(screen.getByText(/Superaste el presupuesto en/)).toBeInTheDocument()
    expect(screen.getByText('COP 1.200.000', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('sin tasa: avisa y deja lo no convertible fuera del total', () => {
    render(<BudgetPanel trip={TRIP} reservations={[res('FLIGHT', 398, 'USD')]} rates={null} />)
    expect(screen.getByText(/Sin tasa de referencia para convertir: USD 398,00/)).toBeInTheDocument()
    expect(screen.getByText(/No hay tasa de referencia configurada/)).toBeInTheDocument()
  })

  it('compacta: barra, porcentaje y disponible, sin desglose', () => {
    render(<BudgetPanel trip={TRIP} reservations={[res('HOTEL', 1_000_000)]} rates={RATES} compact />)
    expect(screen.getByText('20 %')).toBeInTheDocument()
    expect(screen.getByText('COP 4.000.000')).toBeInTheDocument()
    expect(screen.queryByText('Presupuesto')).toBeNull()
  })
})

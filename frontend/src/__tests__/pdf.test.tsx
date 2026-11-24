import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import { AppProvider, type Services } from '../app/AppContext'
import type { ExchangeRates } from '../config/config'
import { downloadTripPdf, downloadVoucherPdf } from '../pdf/download'
import { dayHeading, SIMULATED_NOTE, tripPdfModel, voucherPdfModel, weatherLine } from '../pdf/models'
import { buildTripPdf, buildVoucherPdf } from '../pdf/render'
import { pdfText, safeFileName } from '../pdf/sanitize'
import { TripDetail } from '../pages/TripDetail'
import { setConfig } from '../config/config'
import type { Reservation, Trip, TripDetailResponse } from '../types'

// jsPDF agrega save() por instancia (no existe en el prototipo): se intercepta al construir el documento.
const saved = vi.hoisted(() => ({ names: [] as string[], onSave: () => {} }))
vi.mock('../pdf/render', async (orig) => {
  const m = await orig<typeof import('../pdf/render')>()
  const wrap = (build: (model: never) => { doc: jsPDF; filename: string }) => (model: never) => {
    const r = build(model)
    r.doc.save = ((name: string) => {
      saved.names.push(name)
      saved.onSave()
      return r.doc
    }) as never
    return r
  }
  return { ...m, buildTripPdf: wrap(m.buildTripPdf as never), buildVoucherPdf: wrap(m.buildVoucherPdf as never) }
})

const RATES: ExchangeRates = { base: 'COP', USD: 3300, asOf: '2026-11-24', label: 'Tasa de referencia aproximada (TRM nov. 2026)' }
const NOW = new Date('2026-11-24T15:00:00Z')

const TRIP: Trip = {
  tripId: 'TRP-0123abcd',
  title: 'Vacaciones en Cartagena ✈️',
  origin: 'Bogotá, Colombia',
  destination: 'Cartagena, Colombia',
  startDate: '2026-12-04',
  endDate: '2026-12-07',
  travelers: 3,
  budget: 5_000_000,
  currency: 'COP',
  createdBy: 'assistant',
  status: 'PLANNED',
  createdAt: '',
  updatedAt: '',
}
const FLIGHT: Reservation = {
  resId: 'RES-aaaa1111',
  tripId: TRIP.tripId,
  type: 'FLIGHT',
  status: 'SIMULADA',
  provider: 'Wingo',
  details: { airline: 'Wingo', flightNumber: 'P57216', departureTime: '2026-12-04T06:35', arrivalTime: '2026-12-04T08:10', origin: 'BOG', destination: 'CTG', bookingUrl: 'https://kiwi.com/u/yu5uwzgvp4' },
  price: 398,
  currency: 'USD',
  createdBy: 'assistant',
  createdAt: '',
  updatedAt: '',
}
const HOTEL: Reservation = { ...FLIGHT, resId: 'RES-bbbb2222', type: 'HOTEL', provider: 'Hotel Caribe', details: { hotelName: 'Hotel Caribe', checkIn: '2026-12-04', checkOut: '2026-12-07' }, price: 1_200_000, currency: 'COP' }
const DAYS = [
  { date: '2026-12-04', weather: { tempMax: 32, tempMin: 27, rainProbability: 83, condition: 'Llovizna ligera' }, items: [{ time: '10:00', title: 'Ciudad Amurallada → centro', type: 'activity' as const, location: 'Cartagena' }, { time: '08:30', title: 'Desayuno ≈ típico', type: 'meal' as const }] },
  { date: '2026-12-05', items: [] },
]

const text = (doc: jsPDF) => doc.output()

describe('saneado de texto', () => {
  it('conserva tildes, ñ, ¿ y ¡; reemplaza flechas, ≈, guiones largos y quita emojis', () => {
    expect(pdfText('Año nuevo: ¿cómo estás? ¡Sí!')).toBe('Año nuevo: ¿cómo estás? ¡Sí!')
    expect(pdfText('BOG → CTG')).toBe('BOG -> CTG')
    expect(pdfText('≈ COP 2.000')).toBe('aprox. COP 2.000')
    expect(pdfText('a — b – c')).toBe('a - b - c')
    expect(pdfText('“hola” ‘x’…')).toBe('"hola" \'x\'...')
    expect(pdfText('Playa 🏖️ y sol ☀️ 🇨🇴')).toBe('Playa y sol')
    expect(pdfText('COP 5.000')).toBe('COP 5.000')
    expect(pdfText(null)).toBe('')
    expect(pdfText('a​b')).toBe('ab')
  })
  it('todo lo que sale es Latin-1', () => {
    for (const ch of pdfText('日本語 Ωmega ♥ ñandú ∑ ½')) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0xff)
  })
  it('nombres de archivo seguros', () => expect(safeFileName('TRP-01/ab c')).toBe('TRP-01_ab_c'))
})

describe('modelos de documento', () => {
  it('encabezado del dia con weekday calculado: viernes 4 de diciembre de 2026', () => {
    expect(dayHeading('2026-12-04')).toBe('viernes 4 de diciembre de 2026')
    expect(dayHeading('2026-12-06')).toBe('domingo 6 de diciembre de 2026')
  })
  it('clima: maximo/minimo, lluvia y condicion', () => {
    expect(weatherLine(DAYS[0].weather)).toBe('Llovizna ligera - máx 32° / mín 27° - 83 % de lluvia')
    expect(weatherLine(undefined)).toBe('Sin pronóstico')
  })

  it('viaje: nombre de archivo, portada, resumen del presupuesto, reservas e itinerario ordenado', () => {
    const m = tripPdfModel({ trip: TRIP, itinerary: { days: DAYS }, reservations: [FLIGHT, HOTEL], rates: RATES, now: NOW })
    expect(m.filename).toBe('TripPlanner_TRP-0123abcd.pdf')
    expect(m.generatedLabel).toBe('Generado el 24 de noviembre de 2026')
    expect(m.title).toBe('Vacaciones en Cartagena') // sin emoji
    expect(m.route).toBe('Bogotá, Colombia -> Cartagena, Colombia')
    expect(m.dates).toBe('4 de diciembre de 2026 - 7 de diciembre de 2026')
    expect(m.travelers).toBe('3')
    expect(m.budget).toBe('COP 5.000.000')
    expect(m.budgetSummary[0]).toContain('aprox. COP 2.513.400') // 398*3300 + 1.200.000
    expect(m.budgetSummary[0]).toContain('50 %')
    expect(m.budgetSummary.join('\n')).toContain('Disponible: aprox. COP 2.486.600')
    expect(m.budgetSummary.at(-1)).toContain('Tasa de referencia aproximada (TRM nov. 2026) - USD 1 = COP 3.300 - al 24 de noviembre de 2026')
    expect(m.reservations.head).toEqual(['ID', 'Tipo', 'Detalle', 'Fecha', 'Precio', 'Estado'])
    expect(m.reservations.rows[0]).toEqual(['RES-aaaa1111', 'Vuelo', 'Wingo P57216 - BOG -> CTG', expect.stringContaining('2026'), 'USD 398,00', 'Simulada'])
    expect(m.days[0].heading).toBe('viernes 4 de diciembre de 2026')
    expect(m.days[0].activities.map((a) => a.time)).toEqual(['08:30', '10:00']) // por hora
    expect(m.days[0].activities[1].title).toBe('Ciudad Amurallada -> centro')
    expect(m.days[1].weather).toBe('Sin pronóstico')
  })

  it('viaje sin tasa y sin reservas', () => {
    const m = tripPdfModel({ trip: TRIP, itinerary: null, reservations: [FLIGHT], rates: null, now: NOW })
    expect(m.hasItinerary).toBe(false)
    expect(m.budgetSummary.join('\n')).toContain('Sin tasa para convertir (no incluido): USD 398,00')
    expect(m.budgetSummary.at(-1)).toContain('Sin tasa de referencia')
  })

  it('comprobante: archivo, datos del vuelo, enlace como texto, viaje y dia correspondiente', () => {
    const m = voucherPdfModel({ trip: TRIP, reservation: FLIGHT, day: DAYS[0], now: NOW })
    expect(m.filename).toBe('Comprobante_RES-aaaa1111.pdf')
    expect(m.heading).toBe('Vuelo - RES-aaaa1111')
    expect(m.simulated).toBe(true)
    expect(m.details.map((d) => d[0])).toEqual(['Aerolínea', 'Número de vuelo', 'Salida', 'Llegada', 'Origen', 'Destino'])
    expect(m.details.find((d) => d[0] === 'Salida')?.[1]).toContain('06:35')
    expect(m.bookingUrl).toBe('https://kiwi.com/u/yu5uwzgvp4')
    expect(m.price).toBe('USD 398,00')
    expect(m.trip.map((t) => t[0])).toEqual(['Título', 'Ruta', 'Fechas', 'Viajeros'])
    expect(m.day?.heading).toBe('viernes 4 de diciembre de 2026')
    expect(voucherPdfModel({ trip: TRIP, reservation: HOTEL, day: null, now: NOW }).day).toBeNull()
  })
})

describe('PDF real (jsPDF en jsdom)', () => {
  it('viaje: A4, cabecera, secciones, pie en cada pagina con "Pagina X de Y"', () => {
    // muchos dias para forzar varias paginas
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-12-${String(i + 1).padStart(2, '0')}`, weather: DAYS[0].weather, items: DAYS[0].items }))
    const { doc, filename } = buildTripPdf(tripPdfModel({ trip: TRIP, itinerary: { days }, reservations: [FLIGHT, HOTEL], rates: RATES, now: NOW }))
    expect(filename).toBe('TripPlanner_TRP-0123abcd.pdf')
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0)
    const pages = doc.getNumberOfPages()
    expect(pages).toBeGreaterThan(1)
    const out = text(doc)
    for (const s of ['TripPlanner AI', 'Generado el 24 de noviembre de 2026', 'Resumen del presupuesto', 'Reservas', 'Itinerario', 'viernes 4 de diciembre de 2026', 'RES-aaaa1111']) expect(out).toContain(s)
    expect(out.split(SIMULATED_NOTE).length - 1).toBe(pages) // el aviso va en TODAS las paginas
    expect(out).toContain(`(Página 1 de ${pages})`)
    expect(out).toContain(`(Página ${pages} de ${pages})`)
    expect(out).not.toMatch(/[→≈]/)
  })

  it('comprobante: secciones y aviso de simulada', () => {
    const { doc, filename } = buildVoucherPdf(voucherPdfModel({ trip: TRIP, reservation: FLIGHT, day: DAYS[0], now: NOW }))
    expect(filename).toBe('Comprobante_RES-aaaa1111.pdf')
    const out = text(doc)
    for (const s of ['Comprobante de reserva', 'Vuelo - RES-aaaa1111', 'Wingo', 'P57216', 'https://kiwi.com/u/yu5uwzgvp4', 'Vacaciones en Cartagena', 'viernes 4 de diciembre de 2026', SIMULATED_NOTE]) expect(out).toContain(s)
    expect(doc.getNumberOfPages()).toBe(1)
  })
})

describe('descarga', () => {
  it('downloadTripPdf y downloadVoucherPdf guardan con el nombre esperado', async () => {
    saved.names.length = 0
    setConfig({ apiUrl: 'https://a', region: 'r', userPoolId: 'p', userPoolClientId: 'c', orchestratorRuntimeArn: 'a', exchangeRates: RATES })
    expect(await downloadTripPdf({ trip: TRIP, itinerary: { days: DAYS }, reservations: [FLIGHT] })).toBe('TripPlanner_TRP-0123abcd.pdf')
    expect(await downloadVoucherPdf({ trip: TRIP, reservation: FLIGHT, day: null })).toBe('Comprobante_RES-aaaa1111.pdf')
    expect(saved.names).toEqual(['TripPlanner_TRP-0123abcd.pdf', 'Comprobante_RES-aaaa1111.pdf'])
  })
})

describe('carga diferida de jsPDF', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
  const src = join(process.cwd(), 'src')

  it('solo pdf/render.ts importa jspdf; el resto del codigo no lo carga de forma estatica', () => {
    const offenders = walk(src)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) => /from\s+['"]jspdf(-autotable)?['"]/.test(readFileSync(f, 'utf-8')))
      .map((f) => f.slice(src.length + 1).replace(/\\/g, '/'))
    expect(offenders).toEqual(['pdf/render.ts'])
  })
  it('download.ts lo carga con import() dinamico y nadie importa render de forma estatica', () => {
    const dl = readFileSync(join(src, 'pdf/download.ts'), 'utf-8')
    expect(dl).toMatch(/import\(\s*['"]\.\/render['"]\s*\)/)
    expect(dl).not.toMatch(/^import .* from '\.\/render'/m)
    const staticUsers = walk(src).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__') && /^import .* from '[^']*pdf\/render'/m.test(readFileSync(f, 'utf-8')))
    expect(staticUsers).toEqual([])
  })
})

describe('boton Descargar PDF del detalle del viaje', () => {
  it('al pulsar genera y guarda TripPlanner_<TRP>.pdf y el boton vuelve a estar disponible', async () => {
    saved.names.length = 0
    const detail: TripDetailResponse = { trip: TRIP, itinerary: null, reservations: [FLIGHT] }
    const services = {
      auth: { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => () => {}, email: 'a@b.co', restore: async () => true },
      resources: { getTrip: async () => detail },
    } as unknown as Services
    render(
      <MemoryRouter initialEntries={['/viajes/TRP-0123abcd']}>
        <AppProvider services={services}>
          <Routes>
            <Route path="/viajes/:tripId" element={<TripDetail />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>,
    )
    const btn = await screen.findByRole('button', { name: 'Descargar PDF' })
    fireEvent.click(btn)
    await waitFor(() => expect(saved.names).toEqual(['TripPlanner_TRP-0123abcd.pdf']))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar PDF' })).not.toBeDisabled())
  })
})

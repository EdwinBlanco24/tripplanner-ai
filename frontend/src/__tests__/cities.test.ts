import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildIndex, loadCityIndex, resetCityCache, searchCities, type CityIndex, type CityRow } from '../utils/cities'
import { validateTrip } from '../utils/validation'

const rows = JSON.parse(readFileSync('public/data/cities.json', 'utf8')) as CityRow[]
let index: CityIndex
beforeAll(() => {
  index = buildIndex(rows)
})
const names = (q: string) => searchCities(index, q).map((s) => s.name)

describe('datos de ciudades', () => {
  it('estan ordenados por poblacion desc y traen las columnas esperadas', () => {
    expect(rows.length).toBeGreaterThan(30000)
    expect(rows[0]).toHaveLength(5)
    for (let i = 1; i < 500; i++) expect(rows[i - 1][4]).toBeGreaterThanOrEqual(rows[i][4])
  })
})

describe('busqueda de ciudades', () => {
  it('"colombia" devuelve ciudades colombianas ordenadas por poblacion', () => {
    const r = searchCities(index, 'colombia')
    expect(r).toHaveLength(10)
    expect(r[0].name).toBe('Bogotá')
    expect(r.every((s) => s.label.endsWith('Colombia'))).toBe(true)
    const pop = (n: string) => rows.find((x) => x[0] === n && x[3] === 'CO')![4]
    for (let i = 1; i < r.length; i++) expect(pop(r[i - 1].name)).toBeGreaterThanOrEqual(pop(r[i].name))
  })
  it('"españa" y "spain" devuelven Madrid primero', () => {
    expect(names('españa')[0]).toBe('Madrid')
    expect(names('espana')[0]).toBe('Madrid')
    expect(names('spain')[0]).toBe('Madrid')
    expect(names('SPAIN')[0]).toBe('Madrid')
  })
  it('"bogota" encuentra "Bogotá" (sin tildes ni mayusculas)', () => {
    expect(names('bogota')).toContain('Bogotá')
    expect(names('BOGOTA')[0]).toBe('Bogotá')
  })
  it('la etiqueta es "Ciudad · Region, Pais" con el pais en espanol', () => {
    expect(searchCities(index, 'bogota')[0].label).toBe('Bogotá · Bogota D.C., Colombia')
  })
  it('el valor a guardar es "Ciudad, País" con el país en español', () => {
    const r = searchCities(index, 'cartagena')
    expect(r[0].value).toBe('Cartagena, Colombia')
    expect(r.find((x) => x.label.includes('Murcia'))?.value).toBe('Cartagena, España')
    expect(searchCities(index, 'new york')[0].value).toBe('New York City, Estados Unidos')
  })
  it('prioridad: ciudad exacta antes que las que solo la contienen', () => {
    const r = searchCities(index, 'cartagena')
    expect(r[0].name).toBe('Cartagena')
    expect(r[0].label).toContain('Colombia')
  })
  it('"colom" muestra primero las ciudades de Colombia por poblacion, antes que Colombo', () => {
    const n = names('colom')
    expect(n.slice(0, 3)).toEqual(['Bogotá', 'Cali', 'Medellín'])
    expect(n.indexOf('Bogotá')).toBeLessThan(n.indexOf('Colombo') === -1 ? 99 : n.indexOf('Colombo'))
  })
  it('"colombia" y "españa" no cambian; "bogo" y "carta" priorizan por poblacion', () => {
    expect(names('colombia')[0]).toBe('Bogotá')
    expect(names('españa')[0]).toBe('Madrid')
    expect(names('bogo')[0]).toBe('Bogotá')
    const carta = searchCities(index, 'carta').map((s) => s.label)
    expect(carta[0]).toBe('Cartagena · Bolívar, Colombia')
    expect(carta.findIndex((l) => l.endsWith('Murcia, España'))).toBeGreaterThan(0)
  })
  it('maximo 10 sugerencias y minimo 2 caracteres', () => {
    expect(searchCities(index, 'san').length).toBeLessThanOrEqual(10)
    expect(searchCities(index, 'b')).toEqual([])
    expect(searchCities(index, '  ')).toEqual([])
  })
  it('texto sin coincidencias no rompe', () => {
    expect(searchCities(index, 'ctg')).toEqual([])
    expect(searchCities(index, 'zzzzzqx')).toEqual([])
    expect(searchCities(index, '((')).toEqual([])
  })
})

describe('carga perezosa', () => {
  it('descarga una sola vez y reutiliza el cache; si falla permite reintentar', async () => {
    resetCityCache()
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify(rows.slice(0, 50)), { status: 200 }))
    await loadCityIndex(f as unknown as typeof fetch)
    await loadCityIndex(f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(1)
    resetCityCache()
    const bad = vi.fn().mockResolvedValue(new Response('x', { status: 500 }))
    await expect(loadCityIndex(bad as unknown as typeof fetch)).rejects.toThrow()
    await expect(loadCityIndex(f as unknown as typeof fetch)).resolves.toBeTruthy()
    resetCityCache()
  })
})

describe('origen y destino', () => {
  const ok = { title: 'V', origin: 'Bogotá', destination: 'Cartagena', startDate: '2027-12-04', endDate: '2027-12-07', travelers: 1, budget: 1000, currency: 'COP' as const }
  it('rechaza origen igual a destino (sin tildes ni mayusculas)', () => {
    expect(validateTrip({ ...ok, destination: 'BOGOTA' }, '2027-12-01').destination).toBe('El destino debe ser distinto del origen.')
    expect(validateTrip({ ...ok, destination: ' bogotá ' }, '2027-12-01').destination).toBeTruthy()
  })
  it('acepta ciudades distintas', () => expect(validateTrip(ok, '2027-12-01')).toEqual({}))
})

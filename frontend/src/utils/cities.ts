import { normalizeText } from './text'

/** Fila de public/data/cities.json: [nombre, nombreAscii ("" si es igual), region, ISO2, poblacion]. Datos: GeoNames (CC BY 4.0). */
export type CityRow = [name: string, ascii: string, region: string, cc: string, population: number]

export interface CitySuggestion {
  name: string
  label: string
  /** Lo que se guarda al elegir: "Ciudad, País" (país en español; si no hay, en inglés). */
  value: string
}

export const MAX_SUGGESTIONS = 10
export const MIN_QUERY = 2

interface Entry {
  row: CityRow
  nName: string
  nAscii: string
}
export interface CityIndex {
  entries: Entry[]
  countries: Map<string, string[]> // ISO2 -> nombres normalizados (es y en)
  countryLabel: Map<string, string> // ISO2 -> nombre en espanol para mostrar
}

function regionNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' })
  } catch {
    return null
  }
}

/** Prepara el indice de busqueda (una vez por carga de datos). */
export function buildIndex(rows: CityRow[]): CityIndex {
  const es = regionNames('es')
  const en = regionNames('en')
  const countries = new Map<string, string[]>()
  const countryLabel = new Map<string, string>()
  for (const r of rows) {
    const cc = r[3]
    if (countries.has(cc)) continue
    const nameEn = en?.of(cc) ?? cc
    const nameEs = es?.of(cc) ?? nameEn
    countryLabel.set(cc, nameEs)
    countries.set(cc, Array.from(new Set([normalizeText(nameEs), normalizeText(nameEn)])))
  }
  const entries = rows.map((row) => ({ row, nName: normalizeText(row[0]), nAscii: normalizeText(row[1] || row[0]) }))
  return { entries, countries, countryLabel }
}

/**
 * Prioridad: 0 pais exacto (p. ej. "espana" -> sus ciudades, Madrid primero) y 1 todo lo demas (ciudad exacta,
 * que empieza por el texto, que lo contiene, o pais que empieza por el texto) MEZCLADO y ordenado por poblacion
 * (las filas ya vienen asi): "colom" -> Bogota, Cali... antes que Colombo; "bogo" -> Bogota antes que la
 * ciudad filipina Bogo (una ciudad exacta pequena no desplaza a una grande que empieza por el texto).
 */
export function searchCities(index: CityIndex, query: string, limit = MAX_SUGGESTIONS): CitySuggestion[] {
  const q = normalizeText(query)
  if (q.length < MIN_QUERY) return []
  const buckets: Entry[][] = [[], []]
  const add = (g: number, e: Entry) => {
    if (buckets[g].length < limit) buckets[g].push(e)
  }
  for (const e of index.entries) {
    const names = index.countries.get(e.row[3]) ?? []
    if (names.includes(q)) add(0, e)
    else if (e.nName.includes(q) || e.nAscii.includes(q) || names.some((n) => n.startsWith(q))) add(1, e)
  }
  const out: CitySuggestion[] = []
  for (const b of buckets)
    for (const e of b) {
      if (out.length >= limit) break
      const [name, , region, cc] = e.row
      const country = index.countryLabel.get(cc) ?? cc
      out.push({ name, label: `${name} · ${region ? `${region}, ` : ''}${country}`, value: `${name}, ${country}` })
    }
  return out
}

let cache: Promise<CityIndex> | null = null

/** Carga perezosa de /data/cities.json (se pide una sola vez; si falla se permite reintentar). */
export function loadCityIndex(fetchImpl: typeof fetch = fetch): Promise<CityIndex> {
  if (!cache) {
    cache = fetchImpl('/data/cities.json')
      .then((r) => {
        if (!r.ok) throw new Error('cities')
        return r.json() as Promise<CityRow[]>
      })
      .then(buildIndex)
      .catch((e) => {
        cache = null
        throw e
      })
  }
  return cache
}

export function resetCityCache(): void {
  cache = null
}

/** Tasa de referencia comun (aproximada) para convertir montos a la moneda base. */
export interface ExchangeRates {
  base: 'COP'
  USD: number
  asOf: string
  label: string
}

export interface AppConfig {
  apiUrl: string
  region: string
  userPoolId: string
  userPoolClientId: string
  orchestratorRuntimeArn: string
  /** Opcional: si falta o es invalida, el comparador muestra montos sin convertir y un aviso. */
  exchangeRates?: ExchangeRates | null
}

let current: AppConfig | null = null

const KEYS: (keyof AppConfig)[] = ['apiUrl', 'region', 'userPoolId', 'userPoolClientId', 'orchestratorRuntimeArn']

/** Valida exchangeRates; cualquier problema devuelve null (no es motivo para rechazar la configuracion). */
export function parseExchangeRates(raw: unknown): ExchangeRates | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.base !== 'COP') return null
  if (typeof r.USD !== 'number' || !Number.isFinite(r.USD) || r.USD <= 0) return null
  if (typeof r.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.asOf)) return null
  if (typeof r.label !== 'string' || !r.label.trim()) return null
  return { base: 'COP', USD: r.USD, asOf: r.asOf, label: r.label.trim() }
}

/** Tasas de la configuracion cargada, o null si no hay configuracion o no trae tasas validas. */
export function getExchangeRates(): ExchangeRates | null {
  return current?.exchangeRates ?? null
}

export function parseConfig(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error('config.json no es un objeto')
  const obj = raw as Record<string, unknown>
  for (const k of KEYS) {
    if (typeof obj[k] !== 'string' || (obj[k] as string).length === 0) throw new Error(`config.json: falta ${k}`)
  }
  const apiUrl = (obj.apiUrl as string).replace(/\/+$/, '')
  if (!apiUrl.startsWith('https://')) throw new Error('config.json: apiUrl debe ser https')
  return {
    apiUrl,
    region: obj.region as string,
    userPoolId: obj.userPoolId as string,
    userPoolClientId: obj.userPoolClientId as string,
    orchestratorRuntimeArn: obj.orchestratorRuntimeArn as string,
    exchangeRates: parseExchangeRates(obj.exchangeRates),
  }
}

export async function loadConfig(fetchImpl: typeof fetch = fetch, url = '/config.json'): Promise<AppConfig> {
  const res = await fetchImpl(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`No se pudo cargar la configuracion (${res.status})`)
  current = parseConfig(await res.json())
  return current
}

export function setConfig(c: AppConfig): void {
  current = c
}

export function getConfig(): AppConfig {
  if (!current) throw new Error('La configuracion aun no se ha cargado')
  return current
}

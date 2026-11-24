export interface AppConfig {
  apiUrl: string
  region: string
  userPoolId: string
  userPoolClientId: string
  orchestratorRuntimeArn: string
}

let current: AppConfig | null = null

const KEYS: (keyof AppConfig)[] = ['apiUrl', 'region', 'userPoolId', 'userPoolClientId', 'orchestratorRuntimeArn']

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

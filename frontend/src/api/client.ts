export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: { field?: string; issue?: string }[] }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: { field?: string; issue?: string }[]
  constructor(status: number, code: string, message: string, details: { field?: string; issue?: string }[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface ApiClientDeps {
  baseUrl: string
  getToken: () => string | null
  /** Renueva el token; true si se obtuvo uno nuevo. */
  refresh: () => Promise<boolean>
  /** Se llama cuando el 401 persiste tras refrescar. */
  onUnauthorized: () => void
  fetchImpl?: typeof fetch
}

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
}

const GENERIC: Record<number, string> = {
  401: 'Tu sesión terminó. Inicia sesión de nuevo.',
  403: 'No tienes permiso para esta operación.',
  404: 'No encontramos lo que buscas.',
  429: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  async function send(method: string, path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {}
    const token = deps.getToken()
    // El Bearer va SOLO hacia la API de negocio (baseUrl); el path nunca es una URL absoluta.
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      return await doFetch(`${deps.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'No hay conexión con el servicio. Revisa tu internet e inténtalo de nuevo.')
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!path.startsWith('/')) throw new Error('path debe empezar por /')
    let res = await send(method, path, body)
    if (res.status === 401) {
      const ok = await deps.refresh()
      if (ok) res = await send(method, path, body)
      if (!ok || res.status === 401) {
        deps.onUnauthorized()
        throw new ApiError(401, 'UNAUTHORIZED', GENERIC[401])
      }
    }
    if (res.status === 204) return undefined as T
    let data: unknown
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      const e = (data as ApiErrorBody | null)?.error
      // El backend manda: se muestra su message cuando viene.
      throw new ApiError(
        res.status,
        e?.code ?? 'INTERNAL_ERROR',
        e?.message ?? GENERIC[res.status] ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.',
        e?.details ?? [],
      )
    }
    return data as T
  }

  return { request }
}

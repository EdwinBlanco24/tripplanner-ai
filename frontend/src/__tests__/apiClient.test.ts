import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../api/client'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Opts = { token?: () => string | null; refresh?: () => Promise<boolean>; onUnauthorized?: () => void }

function make(fetchImpl: unknown, opts: Opts = {}) {
  return createApiClient({
    baseUrl: 'https://api.example.com',
    getToken: opts.token ?? (() => 'tok'),
    refresh: opts.refresh ?? (async () => true),
    onUnauthorized: opts.onUnauthorized ?? (() => {}),
    fetchImpl: fetchImpl as typeof fetch,
  })
}

describe('cliente de la API', () => {
  it('envia Bearer solo hacia baseUrl y el cuerpo como JSON', async () => {
    const f = vi.fn().mockResolvedValue(json(201, { trip: { tripId: 'TRP-1' } }))
    const res = await make(f).request<{ trip: { tripId: string } }>('POST', '/trips', { title: 'x' })
    expect(res.trip.tripId).toBe('TRP-1')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.example.com/trips')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"title":"x"}')
  })
  it('rechaza un path absoluto (el Bearer no puede ir a otro host)', async () => {
    const f = vi.fn()
    await expect(make(f).request('GET', 'https://evil.example.com/x')).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })
  it('204 devuelve undefined', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    expect(await make(f).request('DELETE', '/trips/TRP-1')).toBeUndefined()
  })
  it('convierte {"error":{code,message}} en ApiError con el mensaje del backend', async () => {
    const f = vi.fn().mockResolvedValue(
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'endDate debe ser igual o posterior a startDate',
          details: [{ field: 'endDate', issue: 'before_startDate' }],
        },
      }),
    )
    const err = (await make(f).request('POST', '/trips', {}).catch((e: ApiError) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.message).toBe('endDate debe ser igual o posterior a startDate')
    expect(err.details[0].field).toBe('endDate')
  })
  it('usa un mensaje en espanol si el cuerpo no es del formato esperado', async () => {
    const f = vi.fn().mockResolvedValue(new Response('<html>', { status: 500 }))
    const err = (await make(f).request('GET', '/trips').catch((e: ApiError) => e)) as ApiError
    expect(err.status).toBe(500)
    expect(err.message).toMatch(/inesperado/)
  })
  it('un error de red es un ApiError sin detalles tecnicos', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const err = (await make(f).request('GET', '/trips').catch((e: ApiError) => e)) as ApiError
    expect(err.code).toBe('NETWORK_ERROR')
    expect(err.message).not.toMatch(/fetch/i)
  })
  it('ante un 401 refresca y reintenta UNA vez con el token nuevo', async () => {
    let token = 'old'
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, { trips: [] }))
    const refresh = vi.fn(async () => {
      token = 'new'
      return true
    })
    const res = await make(f, { token: () => token, refresh }).request('GET', '/trips')
    expect(res).toEqual({ trips: [] })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer new')
  })
  it('si el reintento tambien da 401 cierra la sesion y no reintenta mas', async () => {
    const f = vi.fn().mockImplementation(async () => json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
    const onUnauthorized = vi.fn()
    const err = (await make(f, { onUnauthorized }).request('GET', '/trips').catch((e: ApiError) => e)) as ApiError
    expect(err.status).toBe(401)
    expect(f).toHaveBeenCalledTimes(2)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
  it('si el refresco falla cierra la sesion sin reintentar la peticion', async () => {
    const f = vi.fn().mockImplementation(async () => json(401, {}))
    const onUnauthorized = vi.fn()
    await make(f, { refresh: async () => false, onUnauthorized }).request('GET', '/trips').catch(() => {})
    expect(f).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

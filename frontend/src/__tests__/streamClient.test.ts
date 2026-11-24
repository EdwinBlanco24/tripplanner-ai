import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agent/events'
import { createStreamClient, invocationUrl, type StreamAuth } from '../agent/streamClient'

const ARN = 'arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/Orch-abc'
const NOW = 1_000_000

function sse(chunks: string[], status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}
const e = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

function auth(over: Partial<StreamAuth> & { token?: string | null; expiresAt?: number; refresh?: () => Promise<boolean> } = {}) {
  let token = over.token === undefined ? 'tok-1' : over.token
  const a = {
    getAccessToken: () => token,
    get tokenExpiresAt() {
      return over.expiresAt ?? NOW + 3_600_000
    },
    refresh: vi.fn(
      over.refresh ??
        (async () => {
          token = 'tok-2'
          return true
        }),
    ),
  }
  return a
}

function make(fetchImpl: unknown, a = auth()) {
  const client = createStreamClient({ region: 'us-east-2', runtimeArn: ARN, auth: a, fetchImpl: fetchImpl as typeof fetch, now: () => NOW })
  const events: AgentEvent[] = []
  const run = (prompt = 'hola', session = 'tp-web-session-0123456789012345678901234567') =>
    client.stream(prompt, session, new AbortController().signal, (x) => events.push(x))
  return { client, events, run, a }
}

describe('streamClient', () => {
  it('URL: host de la region y ARN codificado en la ruta', () => {
    expect(invocationUrl('us-east-2', ARN)).toBe(`https://bedrock-agentcore.us-east-2.amazonaws.com/runtimes/${encodeURIComponent(ARN)}/invocations?qualifier=DEFAULT`)
    expect(invocationUrl('us-east-2', ARN)).toContain('arn%3Aaws%3Abedrock-agentcore')
    expect(() => invocationUrl('evil.com/x', ARN)).toThrow()
    expect(() => invocationUrl('us-east-2', '')).toThrow()
  })

  it('POST con Bearer, Accept SSE, sesion y cuerpo {prompt}; entrega los eventos y termina en done', async () => {
    const f = vi.fn().mockResolvedValue(sse([e({ type: 'text', delta: 'Hola' }), e({ type: 'done' })]))
    const { run, events } = make(f)
    const outcome = await run('¿Qué clima?', 'tp-web-abc')
    expect(outcome).toEqual({ status: 'done' })
    expect(events.map((x) => x.type)).toEqual(['text', 'done'])
    const [url, init] = f.mock.calls[0]
    expect(url).toMatch(/^https:\/\/bedrock-agentcore\.us-east-2\.amazonaws\.com\/runtimes\//)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok-1',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': 'tp-web-abc',
    })
    expect(JSON.parse(init.body)).toEqual({ prompt: '¿Qué clima?' })
  })

  it('eventos partidos entre chunks de red', async () => {
    const full = e({ type: 'ui', component: 'weather', data: { weather: { days: [] } } }) + e({ type: 'done' })
    const f = vi.fn().mockResolvedValue(sse([full.slice(0, 10), full.slice(10, 40), full.slice(40)]))
    const { run, events } = make(f)
    expect(await run()).toEqual({ status: 'done' })
    expect(events.map((x) => x.type)).toEqual(['ui', 'done'])
  })

  it('refresca ANTES si el token vence en menos de 5 min', async () => {
    const f = vi.fn().mockResolvedValue(sse([e({ type: 'done' })]))
    const a = auth({ expiresAt: NOW + 4 * 60_000 })
    await make(f, a).run()
    expect(a.refresh).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-2')
  })

  it('no refresca si queda mas de 5 min', async () => {
    const f = vi.fn().mockResolvedValue(sse([e({ type: 'done' })]))
    const a = auth({ expiresAt: NOW + 6 * 60_000 })
    await make(f, a).run()
    expect(a.refresh).not.toHaveBeenCalled()
  })

  it('401: refresca y reintenta UNA vez con el token nuevo', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 401 })).mockResolvedValueOnce(sse([e({ type: 'done' })]))
    const a = auth()
    const { run } = make(f, a)
    expect(await run()).toEqual({ status: 'done' })
    expect(a.refresh).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-2')
  })

  it('401 repetido: no hay un tercer intento', async () => {
    const f = vi.fn().mockImplementation(async () => new Response('x', { status: 401 }))
    expect(await make(f).run()).toEqual({ status: 'unauthorized' })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('401 con refresco fallido: no reintenta', async () => {
    const f = vi.fn().mockResolvedValue(new Response('x', { status: 401 }))
    expect(await make(f, auth({ refresh: async () => false })).run()).toEqual({ status: 'unauthorized' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('403 y 5xx dan un resultado sin detalles', async () => {
    expect(await make(vi.fn().mockResolvedValue(new Response('secreto', { status: 403 }))).run()).toEqual({ status: 'forbidden' })
    expect(await make(vi.fn().mockResolvedValue(new Response('boom', { status: 503 }))).run()).toEqual({ status: 'server', code: 503 })
  })

  it('stream que termina sin done = conexion perdida', async () => {
    const f = vi.fn().mockResolvedValue(sse([e({ type: 'text', delta: 'parcial' })]))
    const { run, events } = make(f)
    expect(await run()).toEqual({ status: 'lost' })
    expect(events).toHaveLength(1)
  })

  it('error de red = conexion perdida', async () => {
    expect(await make(vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))).run()).toEqual({ status: 'lost' })
  })

  it('Detener (AbortController) devuelve aborted', async () => {
    const f = vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))))
    const { client } = make(f)
    const ctl = new AbortController()
    const p = client.stream('x', 's', ctl.signal, () => {})
    ctl.abort()
    expect(await p).toEqual({ status: 'aborted' })
  })

  it('un evento con error y done no es una conexion perdida', async () => {
    const f = vi.fn().mockResolvedValue(sse([e({ type: 'error', message: 'falló' }), e({ type: 'done' })]))
    const { run, events } = make(f)
    expect(await run()).toEqual({ status: 'done' })
    expect(events[0]).toEqual({ type: 'error', message: 'falló' })
  })
})

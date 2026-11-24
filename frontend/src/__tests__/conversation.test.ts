import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Conversation, LOST_MESSAGE, MSG_FORBIDDEN, MSG_SERVER, ROLLOVER_NOTICE, type StreamLike } from '../agent/conversation'
import type { AgentEvent } from '../agent/events'
import { SESSION_IDLE_MS, SessionTracker, newSessionId } from '../agent/session'
import type { StreamOutcome } from '../agent/streamClient'

function fakeClient(script: (n: number) => { events?: AgentEvent[]; outcome: StreamOutcome }) {
  const calls: { prompt: string; sessionId: string }[] = []
  const client: StreamLike = {
    async stream(prompt, sessionId, _signal, onEvent) {
      calls.push({ prompt, sessionId })
      const r = script(calls.length)
      r.events?.forEach(onEvent)
      return r.outcome
    },
  }
  return { client, calls }
}

const DONE: StreamOutcome = { status: 'done' }
let clock = 0
let n = 0
const make = (client: StreamLike, onDataChanged?: () => void) =>
  new Conversation({ client, sessions: new SessionTracker(() => clock, () => `uuid-${++n}`), onDataChanged })

beforeEach(() => {
  clock = 1_000_000
  n = 0
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('sesiones', () => {
  it('el id es tp-web-<uuid> y mide al menos 33 caracteres', () => {
    expect(newSessionId().startsWith('tp-web-')).toBe(true)
    expect(newSessionId().length).toBeGreaterThanOrEqual(33)
  })

  it('se mantiene la sesion mientras haya actividad reciente', async () => {
    const { client, calls } = fakeClient(() => ({ events: [{ type: 'text', delta: 'a' }, { type: 'done' }], outcome: DONE }))
    const c = make(client)
    await c.send('uno')
    clock += 13 * 60_000
    await c.send('dos')
    expect(calls[1].sessionId).toBe(calls[0].sessionId)
    expect(c.getState().items.some((i) => i.kind === 'notice')).toBe(false)
  })

  it('pasados 14 min desde el ultimo evento: sesion nueva y aviso', async () => {
    const { client, calls } = fakeClient(() => ({ events: [{ type: 'text', delta: 'a' }, { type: 'done' }], outcome: DONE }))
    const c = make(client)
    await c.send('uno')
    clock += SESSION_IDLE_MS + 1000
    await c.send('dos')
    expect(calls[1].sessionId).not.toBe(calls[0].sessionId)
    expect(c.getState().items.find((i) => i.kind === 'notice')).toMatchObject({ text: ROLLOVER_NOTICE })
  })

  it('el reloj corre desde el ULTIMO evento recibido, no desde el envio', async () => {
    let sessionClock = clock
    const client: StreamLike = {
      async stream(_p, _s, _sig, onEvent) {
        clock += 20 * 60_000 // la respuesta tarda 20 min, pero cada evento renueva el reloj
        sessionClock = clock
        onEvent({ type: 'done' })
        return DONE
      },
    }
    const c = make(client)
    await c.send('largo')
    clock = sessionClock + 5 * 60_000
    await c.send('siguiente')
    expect(c.getState().items.some((i) => i.kind === 'notice')).toBe(false)
  })

  it('la primera vez no hay aviso aunque pase el tiempo', async () => {
    const { client } = fakeClient(() => ({ events: [{ type: 'done' }], outcome: DONE }))
    const c = make(client)
    clock += 60 * 60_000
    await c.send('hola')
    expect(c.getState().items.some((i) => i.kind === 'notice')).toBe(false)
  })
})

describe('Reintentar y errores', () => {
  it('sin done: "Se perdió la conexión" y Reintentar reenvia el mismo texto en sesion NUEVA sin duplicar el mensaje', async () => {
    const { client, calls } = fakeClient((k) => (k === 1 ? { events: [{ type: 'text', delta: 'parcial' }], outcome: { status: 'lost' } } : { events: [{ type: 'text', delta: 'listo' }, { type: 'done' }], outcome: DONE }))
    const c = make(client)
    await c.send('Muéstrame mis reservas')
    expect(c.getState().items.some((i) => i.kind === 'lost')).toBe(true)
    expect(LOST_MESSAGE).toBe('Se perdió la conexión.')
    await c.retry()
    expect(calls[1].prompt).toBe('Muéstrame mis reservas')
    expect(calls[1].sessionId).not.toBe(calls[0].sessionId)
    const s = c.getState()
    expect(s.items.some((i) => i.kind === 'lost')).toBe(false)
    expect(s.items.filter((i) => i.kind === 'user')).toHaveLength(1)
    expect(s.running).toBe(false)
  })

  it('403 y 5xx: mensaje en espanol sin detalles', async () => {
    const c1 = make(fakeClient(() => ({ outcome: { status: 'forbidden' } })).client)
    await c1.send('x')
    expect(c1.getState().items.find((i) => i.kind === 'error')).toMatchObject({ message: MSG_FORBIDDEN })
    const c2 = make(fakeClient(() => ({ outcome: { status: 'server', code: 502 } })).client)
    await c2.send('x')
    const msg = (c2.getState().items.find((i) => i.kind === 'error') as { message: string }).message
    expect(msg).toBe(MSG_SERVER)
    expect(msg).not.toMatch(/502/)
  })

  it('no permite enviar dos mensajes a la vez ni vacios', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const calls: string[] = []
    const client: StreamLike = {
      async stream(p) {
        calls.push(p)
        await gate
        return DONE
      },
    }
    const c = make(client)
    const first = c.send('uno')
    await c.send('dos')
    await c.send('   ')
    release()
    await first
    expect(calls).toEqual(['uno'])
  })

  it('Detener aborta y deja el texto parcial', async () => {
    const client: StreamLike = {
      stream: (_p, _s, signal, onEvent) =>
        new Promise((resolve) => {
          onEvent({ type: 'text', delta: 'parcial' })
          signal.addEventListener('abort', () => resolve({ status: 'aborted' }))
        }),
    }
    const c = make(client)
    const p = c.send('x')
    c.stop()
    await p
    const s = c.getState()
    expect(s.running).toBe(false)
    expect(s.items.some((i) => i.kind === 'text')).toBe(true)
    expect(s.items.some((i) => i.kind === 'lost' || i.kind === 'error')).toBe(false)
  })

  it('Nueva conversacion limpia chat y resultados y cambia de sesion', async () => {
    const { client, calls } = fakeClient(() => ({ events: [{ type: 'ui', component: 'flights', data: {} }, { type: 'done' }], outcome: DONE }))
    const c = make(client)
    await c.send('uno')
    c.reset()
    expect(c.getState().items).toEqual([])
    expect(c.getState().uiHistory).toEqual([])
    await c.send('dos')
    expect(calls[1].sessionId).not.toBe(calls[0].sessionId)
  })
})

describe('invalidacion de datos del canal 1', () => {
  it('un ui de viaje/itinerario/reservas avisa; vuelos y clima no', async () => {
    const onChanged = vi.fn()
    const c = make(fakeClient(() => ({ events: [{ type: 'ui', component: 'flights', data: {} }, { type: 'ui', component: 'weather', data: {} }, { type: 'done' }], outcome: DONE })).client, onChanged)
    await c.send('x')
    expect(onChanged).not.toHaveBeenCalled()
    for (const component of ['trip', 'trips', 'itinerary', 'reservations']) {
      const cc = make(fakeClient(() => ({ events: [{ type: 'ui', component, data: {} }, { type: 'done' }], outcome: DONE })).client, onChanged)
      await cc.send('x')
    }
    expect(onChanged).toHaveBeenCalledTimes(4)
  })

  it('una tool de negocio sin ui (p. ej. delete_trip) refresca al recibir done', async () => {
    const onChanged = vi.fn()
    const c = make(fakeClient(() => ({ events: [{ type: 'status', agent: 'business', message: 'Eliminando…' }, { type: 'done' }], outcome: DONE })).client, onChanged)
    await c.send('borra el viaje')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})

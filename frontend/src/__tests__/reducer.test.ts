import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../agent/events'
import { initialConversation, reduce, type ConversationState } from '../agent/reducer'

const run = (events: AgentEvent[], start: ConversationState = reduce(initialConversation, { type: 'send', text: 'hola' })) =>
  events.reduce((s, e) => reduce(s, { type: 'event', event: e }), start)

describe('reducer de la conversacion', () => {
  it('mensaje de la persona y estado en ejecucion', () => {
    const s = reduce(initialConversation, { type: 'send', text: 'hola' })
    expect(s.running).toBe(true)
    expect(s.items).toEqual([{ id: 1, kind: 'user', text: 'hola' }])
  })

  it('los deltas consecutivos se pegan en un solo segmento', () => {
    const s = run([
      { type: 'text', delta: 'Encontré ' },
      { type: 'text', delta: '3 opciones.' },
    ])
    expect(s.items.filter((i) => i.kind === 'text')).toEqual([{ id: 2, kind: 'text', text: 'Encontré 3 opciones.' }])
  })

  it('un status o un ui entre textos abre un segmento nuevo (no se pegan)', () => {
    const s = run([
      { type: 'text', delta: 'Uno.' },
      { type: 'status', agent: 'weather', message: 'Consultando el clima…' },
      { type: 'text', delta: 'Dos.' },
      { type: 'ui', component: 'weather', data: { weather: { days: [] } } },
      { type: 'text', delta: 'Tres.' },
    ])
    expect(s.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.text : ''))).toEqual(['Uno.', 'Dos.', 'Tres.'])
  })

  it('el status queda en curso y pasa a ✓ al llegar el siguiente evento', () => {
    let s = run([{ type: 'status', agent: 'flights', message: 'Consultando…' }])
    expect(s.items.find((i) => i.kind === 'status')).toMatchObject({ done: false })
    s = reduce(s, { type: 'event', event: { type: 'text', delta: 'x' } })
    expect(s.items.find((i) => i.kind === 'status')).toMatchObject({ done: true })
  })

  it('un segundo status completa el anterior; done completa el ultimo y termina', () => {
    let s = run([
      { type: 'status', agent: 'flights', message: 'a' },
      { type: 'status', agent: 'business', message: 'b' },
    ])
    const statuses = () => s.items.filter((i) => i.kind === 'status').map((i) => (i.kind === 'status' ? i.done : null))
    expect(statuses()).toEqual([true, false])
    s = reduce(s, { type: 'event', event: { type: 'done' } })
    expect(statuses()).toEqual([true, true])
    expect(s.running).toBe(false)
  })

  it('ui: ultimo por tipo + historial, con orden creciente', () => {
    const s = run([
      { type: 'ui', component: 'flights', data: { n: 1 } },
      { type: 'ui', component: 'weather', data: { n: 2 } },
      { type: 'ui', component: 'flights', data: { n: 3 } },
    ])
    expect(s.uiLatest.flights).toMatchObject({ data: { n: 3 }, seq: 3 })
    expect(s.uiLatest.weather).toMatchObject({ data: { n: 2 }, seq: 2 })
    expect(s.uiHistory.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('componente desconocido: se guarda sin romper', () => {
    const s = run([{ type: 'ui', component: 'preferences', data: { preferences: null } }])
    expect(s.uiLatest.preferences).toBeDefined()
  })

  it('error del stream queda como item y done cierra', () => {
    const s = run([
      { type: 'error', message: 'Algo falló' },
      { type: 'done' },
    ])
    expect(s.items.find((i) => i.kind === 'error')).toMatchObject({ message: 'Algo falló' })
    expect(s.running).toBe(false)
  })

  it('lost deja el boton Reintentar y retry-start lo quita sin duplicar el mensaje', () => {
    let s = reduce(run([{ type: 'text', delta: 'parcial' }]), { type: 'lost', prompt: 'hola' })
    expect(s.items.some((i) => i.kind === 'lost')).toBe(true)
    expect(s.running).toBe(false)
    s = reduce(s, { type: 'retry-start' })
    expect(s.items.some((i) => i.kind === 'lost')).toBe(false)
    expect(s.items.filter((i) => i.kind === 'user')).toHaveLength(1)
    expect(s.running).toBe(true)
  })

  it('reset vuelve al estado inicial', () => {
    expect(reduce(run([{ type: 'text', delta: 'x' }]), { type: 'reset' })).toEqual(initialConversation)
  })
})

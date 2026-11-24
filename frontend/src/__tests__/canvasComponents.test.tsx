import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Canvas, tabOf, tabSeq } from '../agent/ui/Canvas'
import { initialConversation, isEmptyData, reduce, type ConversationState } from '../agent/reducer'
import type { AgentEvent } from '../agent/events'
import { quickActions } from '../agent/quickActions'

const run = (...events: AgentEvent[]): ConversationState => events.reduce((s, e) => reduce(s, { type: 'event', event: e }), initialConversation)
const ui = (component: string, data: unknown): AgentEvent => ({ type: 'ui', component, data })

describe('componentes del lienzo', () => {
  it('los 6 conocidos siguen creando su pestana', () => {
    for (const [c, t] of [['flights', 'flights'], ['weather', 'weather'], ['trip', 'trip'], ['trips', 'trip'], ['itinerary', 'itinerary'], ['reservations', 'reservations']] as const) {
      expect(tabOf(c, false)).toBe(t)
      expect(tabOf(c, true)).toBe(t)
    }
  })

  it('preferences nunca crea pestana (ni en desarrollo) pero se guarda en el estado', () => {
    expect(tabOf('preferences', true)).toBeNull()
    expect(tabOf('preferences', false)).toBeNull()
    const s = run(ui('preferences', { preferences: { airline: 'Avianca' } }))
    expect(s.uiLatest.preferences).toBeDefined()
    expect(tabSeq(s, 'other', true)).toBe(0)
  })

  it('un componente desconocido: "Otros" solo en desarrollo', () => {
    expect(tabOf('rareza', true)).toBe('other')
    expect(tabOf('rareza', false)).toBeNull()
    const s = run(ui('rareza', { x: 1 }))
    expect(tabSeq(s, 'other', true)).toBeGreaterThan(0)
    expect(tabSeq(s, 'other', false)).toBe(0)
  })

  it('data null, undefined o vacia se ignora: no cambia el estado ni activa pestana', () => {
    for (const d of [null, undefined, {}, [], '  ']) {
      expect(isEmptyData(d)).toBe(true)
      const s = run(ui('flights', d), ui('preferences', d))
      expect(s.uiHistory).toHaveLength(0)
      expect(s.uiLatest).toEqual({})
    }
    expect(isEmptyData({ a: null })).toBe(false)
  })

  it('un flights vacio no pisa los vuelos ya mostrados ni cuenta para las acciones rapidas', () => {
    const s = run(ui('flights', { offers: [1] }), ui('flights', null))
    expect(s.uiLatest.flights.data).toEqual({ offers: [1] })
    expect(quickActions(run(ui('flights', null)))).toEqual([])
  })

  it('el lienzo no muestra la pestana Otros ni el punto por preferences', () => {
    const state = run(ui('preferences', { preferences: { a: 1 } }))
    render(<Canvas state={state} />)
    expect(screen.queryByRole('tab', { name: /Otros/ })).toBeNull()
    for (const t of ['Vuelos', 'Clima', 'Viaje', 'Itinerario', 'Reservas']) expect(screen.getByRole('tab', { name: new RegExp(`^${t}`) })).toBeDisabled()
    expect(screen.queryByLabelText('Datos nuevos')).toBeNull()
  })
})

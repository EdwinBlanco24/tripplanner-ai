import { describe, expect, it } from 'vitest'
import { CREATE_TRIP_MESSAGE, itineraryMessage, quickActions } from '../agent/quickActions'
import type { AgentEvent } from '../agent/events'
import { initialConversation, reduce, type ConversationState } from '../agent/reducer'
import { SUGGESTIONS } from '../agent/ui/ChatPanel'

const TRIP = { trip: { tripId: 'TRP-0123abcd', title: 't', origin: 'Bogotá, Colombia', destination: 'Cartagena, Colombia' } }
const state = (...events: AgentEvent[]): ConversationState => events.reduce((s, e) => reduce(s, { type: 'event', event: e }), initialConversation)
const ui = (component: string, data: unknown = { ok: true }): AgentEvent => ({ type: 'ui', component, data })
const ids = (s: ConversationState) => quickActions(s).map((a) => a.id)

describe('acciones rapidas del lienzo', () => {
  it('sin nada en la conversacion no hay acciones', () => expect(ids(state())).toEqual([]))

  it('vuelos o clima y aun sin viaje: Crear el viaje (con el mensaje exacto)', () => {
    expect(ids(state(ui('flights')))).toEqual(['create-trip'])
    expect(ids(state(ui('weather')))).toEqual(['create-trip'])
    const a = quickActions(state(ui('flights'), ui('weather')))[0]
    expect(a).toMatchObject({ kind: 'send', label: 'Crear el viaje', message: CREATE_TRIP_MESSAGE })
    expect(CREATE_TRIP_MESSAGE).toBe('Crea el viaje con los datos de esta conversación (origen, destino, fechas propuestas, viajeros y presupuesto).')
  })

  it('con viaje y sin itinerario: Generar itinerario con el id del viaje', () => {
    const s = state(ui('flights'), ui('trip', TRIP))
    expect(ids(s)).toEqual(['generate-itinerary', 'reserve-hint'])
    expect(quickActions(s)[0]).toMatchObject({ message: 'Genera el itinerario de mi viaje TRP-0123abcd con actividades turísticas adaptadas al clima de cada día.' })
    expect(itineraryMessage('TRP-1')).toContain('TRP-1')
  })

  it('con viaje y vuelos (sin reservas): recordatorio de reservar desde la pestaña Vuelos', () => {
    const hint = quickActions(state(ui('flights'), ui('trip', TRIP))).find((a) => a.id === 'reserve-hint')
    expect(hint).toMatchObject({ kind: 'hint', label: 'Reserva un vuelo desde la pestaña Vuelos' })
  })

  it('con viaje sin vuelos no hay recordatorio', () => expect(ids(state(ui('trip', TRIP)))).toEqual(['generate-itinerary']))

  it('con itinerario o reservas: Ver mi viaje hacia /viajes/<id>', () => {
    const it = state(ui('trip', TRIP), ui('itinerary', { tripId: 'TRP-0123abcd', days: [{ date: '2026-12-03', items: [] }] }))
    expect(ids(it)).toEqual(['view-trip'])
    expect(quickActions(it)[0]).toMatchObject({ kind: 'link', to: '/viajes/TRP-0123abcd' })
    const res = state(ui('reservations', { tripId: 'TRP-9', change: 'created', reservations: [] }))
    expect(quickActions(res)).toEqual([{ id: 'view-trip', label: 'Ver mi viaje', kind: 'link', to: '/viajes/TRP-9' }])
  })

  it('con itinerario ya no ofrece generarlo ni recordar la reserva si hay reservas', () => {
    const s = state(ui('flights'), ui('trip', TRIP), ui('itinerary', { tripId: 'TRP-0123abcd', days: [] }), ui('reservations', { change: 'created', reservations: [], tripId: 'TRP-0123abcd' }))
    expect(ids(s)).toEqual(['view-trip'])
  })

  it('el primer chip de sugerencias es la frase literal del PDF', () => {
    expect(SUGGESTIONS[0]).toBe(
      'Quiero organizar unas vacaciones de cuatro días en Cartagena. Salgo desde Bogotá, viajo con dos personas más y tengo un presupuesto de 5 millones de pesos. Quiero conocer el clima, encontrar vuelos y organizar algunas actividades turísticas',
    )
  })
})

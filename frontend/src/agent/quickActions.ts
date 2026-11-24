import type { ConversationState } from './reducer'
import { lastTripId } from './messages'
import { parseItinerary, parseReservations } from './uiData'

export type QuickAction =
  | { id: 'create-trip'; label: string; kind: 'send'; message: string }
  | { id: 'generate-itinerary'; label: string; kind: 'send'; message: string }
  | { id: 'reserve-hint'; label: string; kind: 'hint' }
  | { id: 'view-trip'; label: string; kind: 'link'; to: string }

export const CREATE_TRIP_MESSAGE = 'Crea el viaje con los datos de esta conversación (origen, destino, fechas propuestas, viajeros y presupuesto).'
export const itineraryMessage = (tripId: string) => `Genera el itinerario de mi viaje ${tripId} con actividades turísticas adaptadas al clima de cada día.`

/**
 * Acciones rapidas segun lo que ya hay en la conversacion (solo lectura del estado):
 *  - vuelos o clima y aun sin viaje            -> Crear el viaje
 *  - viaje y sin itinerario                    -> Generar itinerario con actividades
 *  - viaje y vuelos y sin reservas             -> recordatorio de Reservar desde la pestana Vuelos
 *  - itinerario o reservas (con viaje conocido)-> Ver mi viaje
 */
export function quickActions(state: ConversationState): QuickAction[] {
  const latest = state.uiLatest
  const hasFlights = !!latest.flights
  const hasWeather = !!latest.weather
  const itinerary = latest.itinerary ? parseItinerary(latest.itinerary.data) : null
  const reservations = latest.reservations ? parseReservations(latest.reservations.data) : null
  const tripId = lastTripId(state.uiHistory)
  const out: QuickAction[] = []

  if ((hasFlights || hasWeather) && !tripId) out.push({ id: 'create-trip', label: 'Crear el viaje', kind: 'send', message: CREATE_TRIP_MESSAGE })
  if (tripId && !itinerary) out.push({ id: 'generate-itinerary', label: 'Generar itinerario con actividades', kind: 'send', message: itineraryMessage(tripId) })
  if (tripId && hasFlights && !reservations) out.push({ id: 'reserve-hint', label: 'Reserva un vuelo desde la pestaña Vuelos', kind: 'hint' })
  const viewId = tripId ?? itinerary?.tripId ?? reservations?.tripId ?? null
  if ((itinerary || reservations) && viewId) out.push({ id: 'view-trip', label: 'Ver mi viaje', kind: 'link', to: `/viajes/${encodeURIComponent(viewId)}` })
  return out
}

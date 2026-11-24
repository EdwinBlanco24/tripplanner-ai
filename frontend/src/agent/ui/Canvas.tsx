import { useEffect, useMemo, useState } from 'react'
import type { ConversationState, UiEntry } from '../reducer'
import { parseFlights, parseItinerary, parseReservations, parseTrip, parseTrips, parseWeather, type Flight } from '../uiData'
import { FlightCards, GenericCard, ItineraryView, ReservationsList, TripCard, TripCards, WeatherCards } from './Cards'

export type TabId = 'flights' | 'weather' | 'trip' | 'itinerary' | 'reservations' | 'other'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'flights', label: 'Vuelos' },
  { id: 'weather', label: 'Clima' },
  { id: 'trip', label: 'Viaje' },
  { id: 'itinerary', label: 'Itinerario' },
  { id: 'reservations', label: 'Reservas' },
  { id: 'other', label: 'Otros' },
]

export function tabOf(component: string): TabId {
  switch (component) {
    case 'flights':
    case 'weather':
    case 'itinerary':
    case 'reservations':
      return component
    case 'trip':
    case 'trips':
      return 'trip'
    default:
      return 'other'
  }
}

/** Mayor seq de la pestana (0 = sin datos). Para "trip" cuenta trip y trips. */
export function tabSeq(state: ConversationState, tab: TabId): number {
  let best = 0
  for (const e of state.uiHistory) if (tabOf(e.component) === tab && e.seq > best) best = e.seq
  return best
}

function renderTab(tab: TabId, state: ConversationState, onReserve?: (f: Flight) => void, busy?: boolean) {
  const latest = state.uiLatest
  switch (tab) {
    case 'flights': {
      const flights = latest.flights ? parseFlights(latest.flights.data) : null
      return flights ? <FlightCards flights={flights} onReserve={onReserve} busy={busy} /> : null
    }
    case 'weather': {
      const weather = latest.weather ? parseWeather(latest.weather.data) : null
      return weather ? <WeatherCards weather={weather} /> : null
    }
    case 'trip': {
      const trip = latest.trip
      const trips = latest.trips
      const useTrips = trips && (!trip || trips.seq > trip.seq)
      if (useTrips) {
        const list = parseTrips(trips.data)
        return list ? <TripCards trips={list} /> : null
      }
      const one = trip ? parseTrip(trip.data) : null
      return one ? <TripCard trip={one.trip} /> : null
    }
    case 'itinerary': {
      const it = latest.itinerary ? parseItinerary(latest.itinerary.data) : null
      return it ? <ItineraryView tripId={it.tripId} days={it.days} /> : null
    }
    case 'reservations': {
      const r = latest.reservations ? parseReservations(latest.reservations.data) : null
      return r ? <ReservationsList reservations={r.reservations} /> : null
    }
    case 'other': {
      const others: UiEntry[] = Object.values(latest).filter((e) => tabOf(e.component) === 'other')
      return others.length ? (
        <div className="result-list">
          {others.map((e) => (
            <GenericCard key={e.component} component={e.component} data={e.data} />
          ))}
        </div>
      ) : null
    }
  }
}

interface Props {
  state: ConversationState
  onReserve?: (f: Flight) => void
  /** Pestanas a mostrar (por omision todas). */
  only?: TabId[]
  /** Avisa cuando llegan datos nuevos a una pestana (para el punto de la pestana Resultados en movil). */
  onNewData?: () => void
}

/** Lienzo: pestanas desactivadas sin datos; la que recibe datos nuevos se activa sola y muestra un punto si no esta activa. */
export function Canvas({ state, onReserve, only, onNewData }: Props) {
  const tabs = useMemo(() => TABS.filter((t) => !only || only.includes(t.id)), [only])
  const [active, setActive] = useState<TabId>(tabs[0].id)
  const [seen, setSeen] = useState<Record<string, number>>({})

  const newest = state.uiHistory[state.uiHistory.length - 1]
  useEffect(() => {
    if (!newest) return
    const tab = tabOf(newest.component)
    if (tabs.some((t) => t.id === tab)) {
      setActive(tab)
      onNewData?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.seq])

  useEffect(() => {
    setSeen((s) => ({ ...s, [active]: tabSeq(state, active) }))
  }, [active, state])

  const content = renderTab(active, state, onReserve, state.running)
  return (
    <section className="canvas" aria-label="Resultados">
      <div className="canvas-tabs" role="tablist">
        {tabs.map((t) => {
          const seq = tabSeq(state, t.id)
          const disabled = seq === 0
          const dot = !disabled && t.id !== active && seq > (seen[t.id] ?? 0)
          if (t.id === 'other' && disabled) return null
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls="canvas-panel"
              disabled={disabled}
              className={`canvas-tab ${active === t.id ? 'active' : ''}`}
              onClick={() => setActive(t.id)}
            >
              {t.label}
              {dot && <span className="new-dot" aria-label="Datos nuevos" />}
            </button>
          )
        })}
      </div>
      <div id="canvas-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="canvas-body">
        {content ?? <p className="muted canvas-empty">Aquí aparecerán los resultados que encuentre el asistente: vuelos, clima, viajes, itinerarios y reservas.</p>}
      </div>
    </section>
  )
}

import { Link } from 'react-router-dom'
import { Button } from 'primereact/button'
import { RouteText } from '../../components/PlaceText'
import { StatusTag } from '../../components/StatusTag'
import { WeatherDay } from '../../components/WeatherDay'
import { formatDate, formatDateLong, weekdayEs } from '../../utils/dates'
import { formatMoney } from '../../utils/money'
import { reservationSummary, TYPE_LABEL } from '../../utils/trips'
import { splitPlace } from '../../utils/place'
import type { ItineraryDay, Reservation, Trip } from '../../types'
import type { Flight, WeatherData } from '../uiData'
import { isSafeHref } from './SafeMarkdown'

const hhmm = (iso: string | null) => (iso && iso.includes('T') ? iso.split('T')[1].slice(0, 5) : '—')
const dayOf = (iso: string | null) => (iso ? iso.split('T')[0] : null)

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
}

export function stopsText(stops: number | null): string {
  if (stops === null) return '—'
  return stops === 0 ? 'Directo' : stops === 1 ? '1 escala' : `${stops} escalas`
}

export function FlightCards({ flights, onReserve, busy }: { flights: Flight[]; onReserve?: (f: Flight) => void; busy?: boolean }) {
  return (
    <div className="result-list">
      {flights.map((f, i) => (
        <article key={`${f.flightNumber}-${i}`} className="card result-card flight-card">
          <div className="flight-top">
            <strong>
              {f.airline ?? 'Aerolínea'} {f.flightNumber}
            </strong>
            <span className="flight-price">{f.price !== null && f.currency ? formatMoney(f.price, f.currency) : '—'}</span>
          </div>
          <div className="flight-route">
            <div>
              <div className="flight-time">{hhmm(f.departureTime)}</div>
              <div className="muted">{f.origin ?? '—'}</div>
            </div>
            <div className="flight-mid muted">
              <i className="pi pi-arrow-right" aria-hidden="true" />
              <div>{formatDuration(f.durationMinutes)}</div>
              <div>{stopsText(f.stops)}</div>
            </div>
            <div>
              <div className="flight-time">{hhmm(f.arrivalTime)}</div>
              <div className="muted">{f.destination ?? '—'}</div>
            </div>
          </div>
          <div className="muted">{dayOf(f.departureTime) ? formatDateLong(dayOf(f.departureTime)) : ''}</div>
          <div className="result-actions">
            {onReserve && <Button label="Reservar" icon="pi pi-bookmark" size="small" onClick={() => onReserve(f)} disabled={busy} />}
            {isSafeHref(f.bookingUrl ?? undefined) && (
              <a href={f.bookingUrl!} target="_blank" rel="noopener noreferrer">
                Ver en Kiwi
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}

export function weatherLocation(location: string | null): string {
  if (!location) return 'Clima'
  const { city, country } = splitPlace(location)
  return country ? `${city}, ${country}` : city
}

export function WeatherCards({ weather }: { weather: WeatherData }) {
  return (
    <div>
      <h3 className="result-title">
        <i className="pi pi-map-marker" aria-hidden="true" /> {weatherLocation(weather.location)}
      </h3>
      <div className="result-list days-grid">
        {weather.days.map((d) => {
          const weekday = d.weekday ?? weekdayEs(d.date) // sin new Date("YYYY-MM-DD")
          return (
            <article key={d.date} className="card result-card weather-card">
              <div className="weather-day">
                <strong style={{ textTransform: 'capitalize' }}>{weekday ?? ''}</strong>
                <span className="muted"> {formatDate(d.date)}</span>
              </div>
              <div className="weather-temps">
                {d.tempMax ?? '–'}° <span className="muted">/ {d.tempMin ?? '–'}°</span>
              </div>
              <div>{d.condition ?? 'Sin condición'}</div>
              <div className="muted">{d.rainProbability !== undefined ? `${d.rainProbability}% de lluvia` : 'Lluvia: sin dato'}</div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export function TripCard({ trip }: { trip: Trip }) {
  return (
    <article className="card result-card">
      <h3 className="trip-title">{trip.title}</h3>
      {trip.createdBy === 'assistant' && <span className="chip">Creado por el asistente</span>}
      <p className="muted">
        <RouteText origin={trip.origin} destination={trip.destination} />
      </p>
      <p>
        {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
      </p>
      <p className="muted">
        <code>{trip.tripId}</code>
      </p>
      <div className="result-actions">
        <Link to={`/viajes/${encodeURIComponent(trip.tripId)}`}>
          <Button label="Ver viaje" icon="pi pi-arrow-right" size="small" />
        </Link>
      </div>
    </article>
  )
}

export function TripCards({ trips }: { trips: Trip[] }) {
  return (
    <div className="result-list">
      {trips.map((t) => (
        <TripCard key={t.tripId} trip={t} />
      ))}
    </div>
  )
}

export function ItineraryView({ tripId, days }: { tripId?: string; days: ItineraryDay[] }) {
  return (
    <div>
      {tripId && (
        <div className="result-actions">
          <Link to={`/viajes/${encodeURIComponent(tripId)}`}>
            <Button label="Ver e imprimir" icon="pi pi-print" size="small" outlined />
          </Link>
        </div>
      )}
      <div className="days">
        {days.map((d) => (
          <article key={d.date} className="day-col">
            <div className="day-head">
              <h3>{formatDateLong(d.date)}</h3>
            </div>
            <WeatherDay weather={d.weather} />
            {d.items.length === 0 ? (
              <p className="muted">Sin actividades.</p>
            ) : (
              <ul className="timeline">
                {d.items.map((it, i) => (
                  <li key={`${it.time}-${i}`}>
                    <span className="time">{it.time}</span>
                    <span>
                      {it.title}
                      {it.location && <span className="muted"> · {it.location}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

export function ReservationsList({ reservations }: { reservations: Reservation[] }) {
  if (reservations.length === 0) return <p className="muted">Sin reservas.</p>
  return (
    <div className="result-list">
      {reservations.map((r) => (
        <article key={r.resId} className="card result-card">
          <div className="flight-top">
            <strong>
              <code>{r.resId}</code> · {TYPE_LABEL[r.type]}
            </strong>
            <StatusTag status={r.status} />
          </div>
          <p>{reservationSummary(r)}</p>
          <p className="muted">
            {formatMoney(r.price, r.currency)} · viaje <code>{r.tripId}</code>
          </p>
          <div className="result-actions">
            <Link to={`/reservas/${encodeURIComponent(r.tripId)}/${encodeURIComponent(r.resId)}/comprobante`}>
              <Button label="Comprobante" icon="pi pi-file" size="small" outlined />
            </Link>
          </div>
        </article>
      ))}
    </div>
  )
}

/** Componente que el frontend no conoce: se muestra tal cual, sin romper. */
export function GenericCard({ component, data }: { component: string; data: unknown }) {
  let text: string
  try {
    text = JSON.stringify(data, null, 2) ?? String(data)
  } catch {
    text = String(data)
  }
  return (
    <article className="card result-card">
      <h3 className="trip-title">{component}</h3>
      <pre className="json-box">{text}</pre>
    </article>
  )
}

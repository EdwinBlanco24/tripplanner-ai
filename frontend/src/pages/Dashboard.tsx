import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Skeleton } from 'primereact/skeleton'
import { useApp } from '../app/AppContext'
import { useLoad } from '../app/hooks'
import { EmptyState } from '../components/EmptyState'
import { StatusTag } from '../components/StatusTag'
import { WeatherDay } from '../components/WeatherDay'
import type { Reservation, Trip, TripDetailResponse } from '../types'
import { formatDate, todayBogota } from '../utils/dates'
import { formatMoney, totalsByCurrency } from '../utils/money'
import { countByStatus, reservationSummary, selectNextTrip, TYPE_LABEL } from '../utils/trips'
import { RouteText } from '../components/PlaceText'

interface DashData {
  trips: Trip[]
  reservations: Reservation[]
  next: TripDetailResponse | null
}

export function Dashboard() {
  const { resources, email } = useApp()
  const { data, loading, error, reload } = useLoad<DashData>(async () => {
    const [trips, reservations] = await Promise.all([resources.listTrips(), resources.listReservations()])
    const nextTrip = selectNextTrip(trips, todayBogota())
    const next = nextTrip ? await resources.getTrip(nextTrip.tripId) : null
    return { trips, reservations, next }
  }, [resources])

  const tripTitle = useMemo(() => new Map((data?.trips ?? []).map((t) => [t.tripId, t.title])), [data])

  const name = email ? email.split('@')[0] : ''

  return (
    <section>
      <div className="page-head">
        <h1>Hola{name ? `, ${name}` : ''}</h1>
        <Link to="/asistente">
          <Button label="Planear con el asistente" icon="pi pi-comments" />
        </Link>
      </div>

      {loading && (
        <div className="grid-2" aria-busy="true" aria-label="Cargando">
          <Skeleton height="12rem" />
          <Skeleton height="12rem" />
          <Skeleton height="10rem" className="span-2" />
        </div>
      )}

      {!loading && error && (
        <div className="card">
          <EmptyState icon="pi-exclamation-triangle" title="No pudimos cargar tu información.">
            <Button label="Reintentar" icon="pi pi-refresh" onClick={reload} />
          </EmptyState>
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid-2">
            <NextTripCard data={data} />
            <SummaryCard data={data} />
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Reservas recientes</h2>
              <Link to="/reservas">Ver todas</Link>
            </div>
            {data.reservations.length === 0 ? (
              <EmptyState icon="pi-ticket" title="Aún no tienes reservas. Pídele una al asistente." />
            ) : (
              <div className="table-scroll">
                <table className="plain-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Tipo</th>
                      <th>Detalle</th>
                      <th>Viaje</th>
                      <th>Precio</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reservations.slice(0, 5).map((r) => (
                      <tr key={r.resId}>
                        <td>{r.resId}</td>
                        <td>{TYPE_LABEL[r.type]}</td>
                        <td>{reservationSummary(r)}</td>
                        <td>{tripTitle.get(r.tripId) ?? r.tripId}</td>
                        <td>{formatMoney(r.price, r.currency)}</td>
                        <td>
                          <StatusTag status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function NextTripCard({ data }: { data: DashData }) {
  if (!data.next) {
    return (
      <div className="card">
        <h2>Próximo viaje</h2>
        <EmptyState icon="pi-map" title="Aún no tienes viajes. Planea uno con el asistente.">
          <Link to="/asistente">
            <Button label="Planear con el asistente" icon="pi pi-comments" />
          </Link>
        </EmptyState>
      </div>
    )
  }
  const { trip, itinerary, reservations } = data.next
  const totals = totalsByCurrency(reservations)
  const firstWeather = itinerary?.days.find((d) => d.weather)
  return (
    <div className="card">
      <div className="card-head">
        <h2>Próximo viaje</h2>
        {trip.createdBy === 'assistant' && <span className="chip">Creado por el asistente</span>}
      </div>
      <h3 className="trip-title">{trip.title}</h3>
      <p className="muted">
        <RouteText origin={trip.origin} destination={trip.destination} /> · {formatDate(trip.startDate)} – {formatDate(trip.endDate)} · {trip.travelers}{' '}
        {trip.travelers === 1 ? 'viajero' : 'viajeros'}
      </p>
      <p>
        Presupuesto: <strong>{formatMoney(trip.budget, trip.currency)}</strong>
      </p>
      <p>
        Reservas:{' '}
        {totals.length === 0 ? (
          <span className="muted">sin reservas</span>
        ) : (
          totals.map((t, i) => (
            <strong key={t.currency}>
              {i > 0 && ' · '}
              {formatMoney(t.total, t.currency)}
            </strong>
          ))
        )}
      </p>
      {firstWeather ? (
        <p>
          Clima {formatDate(firstWeather.date)}: <WeatherDay weather={firstWeather.weather} />
        </p>
      ) : (
        <p className="muted">Sin pronóstico guardado en el itinerario.</p>
      )}
      <Link to={`/viajes/${trip.tripId}`}>
        <Button label="Ver viaje" icon="pi pi-arrow-right" iconPos="right" />
      </Link>
    </div>
  )
}

function SummaryCard({ data }: { data: DashData }) {
  const counts = countByStatus(data.reservations)
  const planned = data.trips.filter((t) => t.status === 'PLANNED').length
  return (
    <div className="card">
      <h2>Resumen</h2>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{planned}</span>
          <span className="muted">viajes planificados</span>
        </div>
        <div className="stat">
          <span className="stat-num">{data.reservations.length}</span>
          <span className="muted">reservas</span>
        </div>
      </div>
      <div className="chips">
        <span className="status-tag status-simulada">Simuladas: {counts.SIMULADA}</span>
        <span className="status-tag status-pendiente">Pendientes: {counts.PENDIENTE}</span>
        <span className="status-tag status-confirmada">Confirmadas: {counts.CONFIRMADA}</span>
      </div>
    </div>
  )
}

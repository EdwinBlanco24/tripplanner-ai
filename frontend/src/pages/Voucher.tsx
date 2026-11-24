import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Skeleton } from 'primereact/skeleton'
import { useApp } from '../app/AppContext'
import { useLoad } from '../app/hooks'
import { EmptyState } from '../components/EmptyState'
import { ReservationDetails } from '../components/ReservationDetails'
import { StatusTag } from '../components/StatusTag'
import { WeatherDay } from '../components/WeatherDay'
import type { ItineraryDay, Reservation, TripDetailResponse } from '../types'
import { formatDate, formatDateLong } from '../utils/dates'
import { formatMoney } from '../utils/money'
import { reservationDate, TYPE_LABEL } from '../utils/trips'
import { RouteText } from '../components/PlaceText'
import { downloadVoucherPdf } from '../pdf/download'
import { usePdfDownload } from '../pdf/usePdfDownload'

export function dayForReservation(r: Reservation, days: ItineraryDay[] | undefined): ItineraryDay | null {
  if (!days) return null
  const date = reservationDate(r)
  return days.find((d) => d.date === date) ?? null
}

export function Voucher() {
  const { tripId = '', resId = '' } = useParams()
  const [params] = useSearchParams()
  const { resources } = useApp()
  const { data, loading, error } = useLoad<TripDetailResponse>(() => resources.getTrip(tripId), [resources, tripId])
  const reservation = data?.reservations.find((r) => r.resId === resId) ?? null
  const autoPrint = params.get('print') === '1'
  const pdf = usePdfDownload()

  useEffect(() => {
    if (!autoPrint || !reservation) return
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [autoPrint, reservation])

  if (loading) return <Skeleton height="20rem" />
  if (error || !data || !reservation) {
    return (
      <div className="card">
        <EmptyState icon="pi-exclamation-triangle" title={error ?? 'No encontramos esta reserva.'}>
          <Link to="/reservas">
            <Button label="Volver a reservas" icon="pi pi-arrow-left" />
          </Link>
        </EmptyState>
      </div>
    )
  }

  const { trip, itinerary } = data
  const day = dayForReservation(reservation, itinerary?.days)

  return (
    <section className="voucher">
      <div className="head-actions no-print">
        <Link to="/reservas">
          <Button label="Volver" icon="pi pi-arrow-left" text />
        </Link>
        <Button label="Imprimir" icon="pi pi-print" outlined onClick={() => window.print()} />
        <Button label="Descargar PDF" icon="pi pi-download" loading={pdf.busy} onClick={() => void pdf.run(() => downloadVoucherPdf({ trip, reservation, day }))} />
      </div>

      <article className="card voucher-sheet">
        <header className="voucher-head">
          <div>
            <p className="muted">TripPlanner AI · Comprobante de reserva</p>
            <h1>
              {TYPE_LABEL[reservation.type]} · {reservation.resId}
            </h1>
          </div>
          <StatusTag status={reservation.status} />
        </header>

        {reservation.status === 'SIMULADA' && <p className="notice">Reserva simulada: no se ha realizado ningún cobro.</p>}

        <h2>Reserva</h2>
        <p className="muted">Proveedor: {reservation.provider}</p>
        <ReservationDetails reservation={reservation} />
        <p>
          Precio: <strong>{formatMoney(reservation.price, reservation.currency)}</strong>
        </p>

        <h2>Viaje</h2>
        <dl className="details-list">
          <div className="details-row">
            <dt>Título</dt>
            <dd>{trip.title}</dd>
          </div>
          <div className="details-row">
            <dt>Ruta</dt>
            <dd>
              <RouteText origin={trip.origin} destination={trip.destination} />
            </dd>
          </div>
          <div className="details-row">
            <dt>Fechas</dt>
            <dd>
              {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
            </dd>
          </div>
          <div className="details-row">
            <dt>Viajeros</dt>
            <dd>{trip.travelers}</dd>
          </div>
        </dl>

        <h2>Día del itinerario</h2>
        {day ? (
          <div className="day-col">
            <h3>{formatDateLong(day.date)}</h3>
            <WeatherDay weather={day.weather} />
            {day.items.length === 0 ? (
              <p className="muted">Sin actividades.</p>
            ) : (
              <ul className="timeline">
                {[...day.items]
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((it, i) => (
                    <li key={i}>
                      <span className="time">{it.time}</span>
                      <div>
                        <strong>{it.title}</strong>
                        {it.location && <div className="muted">{it.location}</div>}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="muted">Este viaje no tiene un día de itinerario para la fecha de esta reserva.</p>
        )}
      </article>
    </section>
  )
}

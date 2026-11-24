import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Skeleton } from 'primereact/skeleton'
import { useApp } from '../app/AppContext'
import { errorMessage, useLoad } from '../app/hooks'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DayEditorDialog, sortItems } from '../components/DayEditorDialog'
import { EmptyState } from '../components/EmptyState'
import { ReservationFormDialog } from '../components/ReservationFormDialog'
import { ReservationRowActions } from '../components/ReservationRowActions'
import { StatusTag } from '../components/StatusTag'
import { TripFormDialog } from '../components/TripFormDialog'
import { WeatherDay } from '../components/WeatherDay'
import type { ItineraryDay, TripDetailResponse } from '../types'
import { eachDay, formatDate, formatDateLong } from '../utils/dates'
import { formatMoney, totalsByCurrency } from '../utils/money'
import { reservationSummary, TYPE_LABEL } from '../utils/trips'
import { RouteText } from '../components/PlaceText'

export function TripDetail() {
  const { tripId = '' } = useParams()
  const { resources, notify } = useApp()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useLoad<TripDetailResponse>(() => resources.getTrip(tripId), [resources, tripId])
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [addRes, setAddRes] = useState(false)
  const [dayEdit, setDayEdit] = useState<ItineraryDay | null>(null)
  const [daySaving, setDaySaving] = useState(false)
  const [dayError, setDayError] = useState<string | null>(null)

  const removeTrip = async () => {
    if (busy) return
    setBusy(true)
    try {
      await resources.deleteTrip(tripId)
      notify('success', 'Viaje eliminado.')
      navigate('/viajes', { replace: true })
    } catch (e) {
      notify('error', errorMessage(e))
      setDeleting(false)
    } finally {
      setBusy(false)
    }
  }

  const createItinerary = async () => {
    if (!data || busy) return
    setBusy(true)
    try {
      const days: ItineraryDay[] = eachDay(data.trip.startDate, data.trip.endDate, 30).map((date) => ({ date, items: [] }))
      await resources.createItinerary(tripId, days)
      notify('success', 'Itinerario creado.')
      reload()
    } catch (e) {
      notify('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const saveDay = async (day: ItineraryDay) => {
    if (!data?.itinerary) return
    setDaySaving(true)
    setDayError(null)
    try {
      const days = data.itinerary.days.map((d) => (d.date === day.date ? { ...day, items: sortItems(day.items) } : d))
      await resources.replaceItinerary(tripId, days)
      notify('success', 'Día guardado.')
      setDayEdit(null)
      reload()
    } catch (e) {
      setDayError(errorMessage(e))
    } finally {
      setDaySaving(false)
    }
  }

  if (loading) {
    return (
      <section aria-busy="true" aria-label="Cargando">
        <Skeleton height="8rem" className="mb" />
        <Skeleton height="14rem" />
      </section>
    )
  }
  if (error || !data) {
    return (
      <section>
        <div className="card">
          <EmptyState icon="pi-exclamation-triangle" title={error ?? 'No encontramos este viaje.'}>
            <Link to="/viajes">
              <Button label="Volver a mis viajes" icon="pi pi-arrow-left" />
            </Link>
          </EmptyState>
        </div>
      </section>
    )
  }

  const { trip, itinerary, reservations } = data
  const totals = totalsByCurrency(reservations)

  return (
    <section className="trip-detail">
      <Link to="/viajes" className="back-link no-print">
        ← Mis viajes
      </Link>
      <div className="card">
        <div className="page-head">
          <div>
            <h1>{trip.title}</h1>
            {trip.createdBy === 'assistant' && <span className="chip">Creado por el asistente</span>}
          </div>
          <div className="head-actions no-print">
            <Button label="Editar" icon="pi pi-pencil" outlined onClick={() => setEditing(true)} />
            <Button label="Imprimir" icon="pi pi-print" outlined onClick={() => window.print()} />
            <Button label="Descargar PDF" icon="pi pi-download" outlined onClick={() => window.print()} />
            <Button label="Eliminar" icon="pi pi-trash" severity="danger" outlined onClick={() => setDeleting(true)} />
          </div>
        </div>
        <dl className="details-list cols">
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
          <div className="details-row">
            <dt>Presupuesto</dt>
            <dd>{formatMoney(trip.budget, trip.currency)}</dd>
          </div>
          <div className="details-row">
            <dt>Estado</dt>
            <dd>{trip.status === 'PLANNED' ? 'Planificado' : 'Cancelado'}</dd>
          </div>
          {trip.notes && (
            <div className="details-row">
              <dt>Notas</dt>
              <dd>{trip.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="card">
        <h2>Itinerario</h2>
        {!itinerary ? (
          <EmptyState icon="pi-calendar" title="Este viaje aún no tiene itinerario.">
            <Button className="no-print" label="Crear itinerario" icon="pi pi-plus" loading={busy} onClick={createItinerary} />
          </EmptyState>
        ) : (
          <div className="days">
            {itinerary.days.map((d) => (
              <article key={d.date} className="day-col">
                <div className="day-head">
                  <h3>{formatDateLong(d.date)}</h3>
                  <Button className="no-print" label="Editar día" icon="pi pi-pencil" text size="small" onClick={() => { setDayError(null); setDayEdit(d) }} />
                </div>
                <WeatherDay weather={d.weather} />
                {d.items.length === 0 ? (
                  <p className="muted">Sin actividades.</p>
                ) : (
                  <ul className="timeline">
                    {sortItems(d.items).map((it, i) => (
                      <li key={i}>
                        <span className="time">{it.time}</span>
                        <div>
                          <strong>{it.title}</strong>
                          {it.location && <div className="muted">{it.location}</div>}
                          {it.notes && <div className="muted">{it.notes}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Reservas del viaje</h2>
          <Button className="no-print" label="Añadir reserva" icon="pi pi-plus" onClick={() => setAddRes(true)} />
        </div>
        {reservations.length === 0 ? (
          <EmptyState icon="pi-ticket" title="Este viaje aún no tiene reservas." />
        ) : (
          <>
            <div className="table-scroll">
              <table className="plain-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Tipo</th>
                    <th>Detalle</th>
                    <th>Precio</th>
                    <th>Estado</th>
                    <th className="no-print">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((r) => (
                    <tr key={r.resId}>
                      <td>{r.resId}</td>
                      <td>{TYPE_LABEL[r.type]}</td>
                      <td>{reservationSummary(r)}</td>
                      <td>{formatMoney(r.price, r.currency)}</td>
                      <td>
                        <StatusTag status={r.status} />
                      </td>
                      <td className="no-print">
                        <ReservationRowActions reservation={r} tripTitle={trip.title} onChanged={reload} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              Total:{' '}
              {totals.map((t, i) => (
                <strong key={t.currency}>
                  {i > 0 && ' · '}
                  {formatMoney(t.total, t.currency)}
                </strong>
              ))}
            </p>
          </>
        )}
      </div>

      <TripFormDialog
        visible={editing}
        trip={trip}
        onHide={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          reload()
        }}
      />
      <ConfirmDialog visible={deleting} title="Eliminar viaje" busy={busy} onConfirm={removeTrip} onCancel={() => setDeleting(false)}>
        <p>
          ¿Eliminar <strong>{trip.title}</strong>? Se borrarán también su itinerario y sus {reservations.length} reserva(s). Esta acción no se puede deshacer.
        </p>
      </ConfirmDialog>
      <ReservationFormDialog
        visible={addRes}
        trip={trip}
        onHide={() => setAddRes(false)}
        onSaved={() => {
          setAddRes(false)
          reload()
        }}
      />
      <DayEditorDialog visible={dayEdit !== null} day={dayEdit} saving={daySaving} error={dayError} onHide={() => setDayEdit(null)} onSave={saveDay} />
    </section>
  )
}

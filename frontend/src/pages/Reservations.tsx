import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { Dropdown } from 'primereact/dropdown'
import { Button } from 'primereact/button'
import { useApp } from '../app/AppContext'
import { useLoad } from '../app/hooks'
import { EmptyState } from '../components/EmptyState'
import { ReservationFormDialog } from '../components/ReservationFormDialog'
import { ReservationRowActions } from '../components/ReservationRowActions'
import { StatusTag } from '../components/StatusTag'
import type { Reservation, ReservationStatus, ReservationType, Trip } from '../types'
import { RESERVATION_STATUSES, RESERVATION_TYPES } from '../types'
import { formatDate } from '../utils/dates'
import { formatMoney } from '../utils/money'
import { reservationDate, reservationSummary, STATUS_LABEL, TYPE_LABEL } from '../utils/trips'

interface Data {
  reservations: Reservation[]
  trips: Trip[]
}

export function Reservations() {
  const { resources } = useApp()
  const { data, loading, error, reload } = useLoad<Data>(async () => {
    const [reservations, trips] = await Promise.all([resources.listReservations(), resources.listTrips()])
    return { reservations, trips }
  }, [resources])
  const [status, setStatus] = useState<ReservationStatus | null>(null)
  const [type, setType] = useState<ReservationType | null>(null)
  const [tripId, setTripId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const titles = useMemo(() => new Map((data?.trips ?? []).map((t) => [t.tripId, t.title])), [data])
  const rows = useMemo(
    () => (data?.reservations ?? []).filter((r) => (!status || r.status === status) && (!type || r.type === type) && (!tripId || r.tripId === tripId)),
    [data, status, type, tripId],
  )

  return (
    <section>
      <div className="page-head">
        <h1>Reservas</h1>
        <Button label="Añadir reserva" icon="pi pi-plus" onClick={() => setAdding(true)} disabled={!data || data.trips.length === 0} />
      </div>

      <div className="card filters">
        <Dropdown value={status} showClear placeholder="Estado" aria-label="Filtrar por estado" options={RESERVATION_STATUSES.map((s) => ({ label: STATUS_LABEL[s], value: s }))} onChange={(e) => setStatus(e.value ?? null)} />
        <Dropdown value={type} showClear placeholder="Tipo" aria-label="Filtrar por tipo" options={RESERVATION_TYPES.map((t) => ({ label: TYPE_LABEL[t], value: t }))} onChange={(e) => setType(e.value ?? null)} />
        <Dropdown value={tripId} showClear placeholder="Viaje" aria-label="Filtrar por viaje" options={(data?.trips ?? []).map((t) => ({ label: t.title, value: t.tripId }))} onChange={(e) => setTripId(e.value ?? null)} />
      </div>

      <div className="card">
        {error ? (
          <EmptyState icon="pi-exclamation-triangle" title="No pudimos cargar tus reservas.">
            <Button label="Reintentar" icon="pi pi-refresh" onClick={reload} />
          </EmptyState>
        ) : (
          <DataTable
            value={rows}
            loading={loading}
            dataKey="resId"
            paginator={rows.length > 10}
            rows={10}
            responsiveLayout="scroll"
            emptyMessage={
              data && data.reservations.length === 0 ? (
                <EmptyState icon="pi-ticket" title="Aún no tienes reservas. Pídele una al asistente.">
                  <Link to="/asistente">
                    <Button label="Planear con el asistente" icon="pi pi-comments" />
                  </Link>
                </EmptyState>
              ) : (
                <EmptyState icon="pi-filter" title="No hay reservas con esos filtros." />
              )
            }
          >
            <Column field="resId" header="ID" />
            <Column header="Tipo" body={(r: Reservation) => TYPE_LABEL[r.type]} />
            <Column header="Detalle" body={(r: Reservation) => reservationSummary(r)} />
            <Column header="Viaje" body={(r: Reservation) => titles.get(r.tripId) ?? r.tripId} />
            <Column header="Fecha" body={(r: Reservation) => formatDate(reservationDate(r))} />
            <Column header="Precio" body={(r: Reservation) => formatMoney(r.price, r.currency)} />
            <Column header="Estado" body={(r: Reservation) => <StatusTag status={r.status} />} />
            <Column header="Acciones" body={(r: Reservation) => <ReservationRowActions reservation={r} tripTitle={titles.get(r.tripId)} trips={data?.trips} onChanged={reload} />} />
          </DataTable>
        )}
      </div>

      <ReservationFormDialog
        visible={adding}
        trips={data?.trips ?? []}
        onHide={() => setAdding(false)}
        onSaved={() => {
          setAdding(false)
          reload()
        }}
      />
    </section>
  )
}

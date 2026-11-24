import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Dropdown } from 'primereact/dropdown'
import { Skeleton } from 'primereact/skeleton'
import { useApp } from '../app/AppContext'
import { useLoad } from '../app/hooks'
import { EmptyState } from '../components/EmptyState'
import { TripFormDialog } from '../components/TripFormDialog'
import type { Trip, TripStatus } from '../types'
import { formatDate } from '../utils/dates'
import { formatMoney } from '../utils/money'
import { RouteText } from '../components/PlaceText'

const FILTERS: { label: string; value: TripStatus | 'ALL' }[] = [
  { label: 'Todos', value: 'ALL' },
  { label: 'Planificados', value: 'PLANNED' },
  { label: 'Cancelados', value: 'CANCELLED' },
]

export function Trips() {
  const { resources } = useApp()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useLoad<Trip[]>(() => resources.listTrips(), [resources])
  const [filter, setFilter] = useState<TripStatus | 'ALL'>('ALL')
  const [creating, setCreating] = useState(false)

  const shown = useMemo(() => (data ?? []).filter((t) => filter === 'ALL' || t.status === filter), [data, filter])

  return (
    <section>
      <div className="page-head">
        <h1>Mis viajes</h1>
        <div className="head-actions">
          <Dropdown value={filter} options={FILTERS} onChange={(e) => setFilter(e.value as TripStatus | 'ALL')} aria-label="Filtrar por estado" />
          <Button label="Nuevo viaje" icon="pi pi-plus" onClick={() => setCreating(true)} />
        </div>
      </div>

      {loading && (
        <div className="cards" aria-busy="true" aria-label="Cargando">
          <Skeleton height="9rem" />
          <Skeleton height="9rem" />
          <Skeleton height="9rem" />
        </div>
      )}
      {!loading && error && (
        <div className="card">
          <EmptyState icon="pi-exclamation-triangle" title="No pudimos cargar tus viajes.">
            <Button label="Reintentar" icon="pi pi-refresh" onClick={reload} />
          </EmptyState>
        </div>
      )}
      {!loading && data && data.length === 0 && (
        <div className="card">
          <EmptyState icon="pi-map" title="Aún no tienes viajes. Planea uno con el asistente.">
            <Link to="/asistente">
              <Button label="Planear con el asistente" icon="pi pi-comments" />
            </Link>
          </EmptyState>
        </div>
      )}
      {!loading && data && data.length > 0 && shown.length === 0 && (
        <div className="card">
          <EmptyState icon="pi-filter" title="No hay viajes con ese estado." />
        </div>
      )}
      {!loading && shown.length > 0 && (
        <div className="cards">
          {shown.map((t) => (
            <article key={t.tripId} className="card trip-card">
              <div className="card-head">
                <h2 className="trip-title">{t.title}</h2>
                <span className={`status-tag ${t.status === 'PLANNED' ? 'status-confirmada' : 'status-neutral'}`}>
                  {t.status === 'PLANNED' ? 'Planificado' : 'Cancelado'}
                </span>
              </div>
              {t.createdBy === 'assistant' && <span className="chip">Creado por el asistente</span>}
              <p className="muted">
                <RouteText origin={t.origin} destination={t.destination} />
              </p>
              <p>
                {formatDate(t.startDate)} – {formatDate(t.endDate)}
              </p>
              <p className="muted">
                {t.travelers} {t.travelers === 1 ? 'viajero' : 'viajeros'} · {formatMoney(t.budget, t.currency)}
              </p>
              <Link to={`/viajes/${t.tripId}`}>
                <Button label="Ver viaje" text icon="pi pi-arrow-right" iconPos="right" />
              </Link>
            </article>
          ))}
        </div>
      )}

      <TripFormDialog
        visible={creating}
        onHide={() => setCreating(false)}
        onSaved={(t) => {
          setCreating(false)
          reload()
          navigate(`/viajes/${t.tripId}`)
        }}
      />
    </section>
  )
}

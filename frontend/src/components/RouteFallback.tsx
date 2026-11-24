import { Skeleton } from 'primereact/skeleton'

/** Esqueleto mientras se descarga el codigo de una ruta cargada de forma diferida. */
export function RouteFallback() {
  return (
    <section aria-busy="true" aria-label="Cargando">
      <Skeleton height="2.5rem" width="40%" className="mb" />
      <Skeleton height="12rem" className="mb" />
      <Skeleton height="8rem" />
    </section>
  )
}

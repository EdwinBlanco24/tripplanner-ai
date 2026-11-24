import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useApp } from './AppContext'

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.'
}

export interface Loadable<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** Carga asincrona con estado de carga y error (en espanol, sin detalles tecnicos). */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): Loadable<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const { notify, dataVersion } = useApp()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loaderRef
      .current()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (cancelled) return
        const msg = errorMessage(e)
        setError(msg)
        if (!(e instanceof ApiError && e.status === 401)) notify('error', msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, dataVersion, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, reload }
}

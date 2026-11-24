import { useCallback, useRef, useState } from 'react'
import { useApp } from '../app/AppContext'

/** Ejecuta una descarga de PDF con estado "generando" (el boton muestra spinner) y aviso de error. */
export function usePdfDownload(): { busy: boolean; run: (job: () => Promise<string>) => Promise<void> } {
  const { notify } = useApp()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const run = useCallback(
    async (job: () => Promise<string>) => {
      if (lock.current) return
      lock.current = true
      setBusy(true)
      try {
        await job()
      } catch {
        notify('error', 'No se pudo generar el PDF. Inténtalo de nuevo.')
      } finally {
        lock.current = false
        setBusy(false)
      }
    },
    [notify],
  )
  return { busy, run }
}

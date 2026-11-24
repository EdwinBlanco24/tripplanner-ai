import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Dialog } from 'primereact/dialog'

interface Props {
  visible: boolean
  header: ReactNode
  onHide: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
  className?: string
}

/**
 * Dialogo comun. Regla: boton de ampliar junto a la X (maximizable). Esc: si esta ampliado sale de pantalla
 * completa; si no, cierra. El Esc propio de PrimeReact se desactiva y se maneja aqui, para que el
 * comportamiento sea el mismo en todos los dialogos.
 */
export function AppDialog({ visible, header, onHide, children, footer, width = '40rem', className }: Props) {
  const [maximized, setMaximized] = useState(false)

  // Al abrir se empieza siempre en tamano normal.
  useEffect(() => {
    if (!visible) setMaximized(false)
  }, [visible])

  const onKey = useCallback(
    (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      // Con una lista abierta (sugerencias o desplegable) el Esc es de la lista: la cierra y el dialogo se queda.
      if (document.querySelector('.p-autocomplete-panel, .p-dropdown-panel')) return
      ev.preventDefault()
      ev.stopPropagation()
      if (maximized) setMaximized(false)
      else onHide()
    },
    [maximized, onHide],
  )

  useEffect(() => {
    if (!visible) return
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [visible, onKey])

  return (
    <Dialog
      visible={visible}
      header={header}
      footer={footer}
      onHide={onHide}
      maximizable
      maximized={maximized}
      onMaximize={(e) => setMaximized(e.maximized)}
      closeOnEscape={false}
      modal
      draggable={false}
      blockScroll
      className={`app-dialog ${className ?? ''}`}
      style={{ width, maxWidth: '96vw' }}
      breakpoints={{ '640px': '96vw' }}
    >
      {children}
    </Dialog>
  )
}

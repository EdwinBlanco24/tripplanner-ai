import type { ReactNode } from 'react'
import { Button } from 'primereact/button'
import { AppDialog } from './AppDialog'

interface Props {
  visible: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Confirmacion destructiva sobre AppDialog (misma regla de ampliar y Esc). */
export function ConfirmDialog({ visible, title, children, confirmLabel = 'Eliminar', busy, onConfirm, onCancel }: Props) {
  return (
    <AppDialog
      visible={visible}
      header={title}
      onHide={onCancel}
      width="28rem"
      footer={
        <div className="dialog-actions">
          <Button label="Cancelar" severity="secondary" outlined onClick={onCancel} disabled={busy} />
          <Button label={confirmLabel} severity="danger" onClick={onConfirm} loading={busy} />
        </div>
      }
    >
      {children}
    </AppDialog>
  )
}

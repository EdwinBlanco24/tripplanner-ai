import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { useApp } from '../app/AppContext'
import { errorMessage } from '../app/hooks'
import { AppDialog } from './AppDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { ReservationDetails } from './ReservationDetails'
import { ReservationFormDialog } from './ReservationFormDialog'
import { StatusTag } from './StatusTag'
import type { Reservation, Trip } from '../types'
import { formatMoney } from '../utils/money'
import { nextStatus, STATUS_LABEL, TYPE_LABEL } from '../utils/trips'

interface Props {
  reservation: Reservation
  tripTitle?: string
  trips?: Trip[]
  onChanged: () => void
}

/** Acciones por reserva: Ver, Cambiar estado, Editar, Eliminar e Imprimir (abre el comprobante). */
export function ReservationRowActions({ reservation: r, tripTitle, trips, onChanged }: Props) {
  const { resources, notify } = useApp()
  const navigate = useNavigate()
  const [view, setView] = useState(false)
  const [edit, setEdit] = useState(false)
  const [del, setDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const next = nextStatus(r.status)

  const advance = async () => {
    if (!next || busy) return
    setBusy(true)
    try {
      await resources.updateReservation(r.tripId, r.resId, { status: next })
      notify('success', `Reserva ${r.resId}: ${STATUS_LABEL[next]}.`)
      onChanged()
    } catch (e) {
      notify('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await resources.deleteReservation(r.tripId, r.resId)
      notify('success', 'Reserva eliminada.')
      setDel(false)
      onChanged()
    } catch (e) {
      notify('error', errorMessage(e))
      setDel(false)
    } finally {
      setBusy(false)
    }
  }

  const voucher = `/reservas/${r.tripId}/${r.resId}/comprobante`

  return (
    <div className="row-actions">
      <Button icon="pi pi-eye" text rounded aria-label={`Ver reserva ${r.resId}`} tooltip="Ver" tooltipOptions={{ position: 'top' }} onClick={() => setView(true)} />
      {next && (
        <Button
          icon="pi pi-forward"
          text
          rounded
          aria-label={`Marcar ${r.resId} como ${STATUS_LABEL[next]}`}
          tooltip={`Pasar a ${STATUS_LABEL[next]}`}
          tooltipOptions={{ position: 'top' }}
          loading={busy}
          onClick={advance}
        />
      )}
      <Button icon="pi pi-pencil" text rounded aria-label={`Editar reserva ${r.resId}`} tooltip="Editar" tooltipOptions={{ position: 'top' }} onClick={() => setEdit(true)} />
      <Button icon="pi pi-print" text rounded aria-label={`Imprimir reserva ${r.resId}`} tooltip="Imprimir" tooltipOptions={{ position: 'top' }} onClick={() => navigate(`${voucher}?print=1`)} />
      <Button icon="pi pi-trash" text rounded severity="danger" aria-label={`Eliminar reserva ${r.resId}`} tooltip="Eliminar" tooltipOptions={{ position: 'top' }} onClick={() => setDel(true)} />

      <AppDialog
        visible={view}
        header={`Reserva ${r.resId}`}
        onHide={() => setView(false)}
        width="36rem"
        footer={
          <div className="dialog-actions">
            <Button label="Ver comprobante" icon="pi pi-file" outlined onClick={() => navigate(voucher)} />
            <Button label="Cerrar" onClick={() => setView(false)} />
          </div>
        }
      >
        <p>
          <StatusTag status={r.status} /> <span className="muted">{TYPE_LABEL[r.type]} · {r.provider}</span>
        </p>
        {tripTitle && (
          <p className="muted">
            Viaje: <strong>{tripTitle}</strong>
          </p>
        )}
        <ReservationDetails reservation={r} />
        <p>
          Precio: <strong>{formatMoney(r.price, r.currency)}</strong>
        </p>
        {r.status === 'SIMULADA' && <p className="notice">Reserva simulada: no se ha realizado ningún cobro.</p>}
      </AppDialog>

      <ReservationFormDialog
        visible={edit}
        reservation={r}
        trips={trips}
        onHide={() => setEdit(false)}
        onSaved={() => {
          setEdit(false)
          onChanged()
        }}
      />

      <ConfirmDialog visible={del} title="Eliminar reserva" busy={busy} onConfirm={remove} onCancel={() => setDel(false)}>
        <p>
          ¿Eliminar la reserva <strong>{r.resId}</strong>? Esta acción no se puede deshacer.
        </p>
      </ConfirmDialog>
    </div>
  )
}

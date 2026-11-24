import type { ReservationStatus } from '../types'
import { STATUS_LABEL } from '../utils/trips'

/** Estado de reserva con texto + color (no solo color). */
export function StatusTag({ status }: { status: ReservationStatus }) {
  return (
    <span className={`status-tag status-${status.toLowerCase()}`} data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  )
}

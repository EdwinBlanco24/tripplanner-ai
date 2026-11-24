import type { Reservation } from '../types'
import { DETAIL_KEYS, DETAIL_LABELS } from '../utils/validation'
import { formatDate, formatDateTime } from '../utils/dates'

const DATETIME = new Set(['departureTime', 'arrivalTime'])
const DATE = new Set(['checkIn', 'checkOut', 'date'])

/** Lista de datos del vuelo/hotel/actividad. El enlace de reserva solo se pinta como enlace si es https. */
export function ReservationDetails({ reservation }: { reservation: Reservation }) {
  const keys = DETAIL_KEYS[reservation.type].filter((k) => reservation.details[k])
  return (
    <dl className="details-list">
      {keys.map((k) => {
        const val = reservation.details[k]
        let content: React.ReactNode = val
        if (DATETIME.has(k)) content = formatDateTime(val)
        else if (DATE.has(k)) content = formatDate(val)
        else if (k === 'bookingUrl') {
          content = val.startsWith('https://') ? (
            <a href={val} target="_blank" rel="noopener noreferrer">
              Abrir enlace de reserva
            </a>
          ) : (
            val
          )
        }
        return (
          <div key={k} className="details-row">
            <dt>{DETAIL_LABELS[k]}</dt>
            <dd>{content}</dd>
          </div>
        )
      })}
    </dl>
  )
}

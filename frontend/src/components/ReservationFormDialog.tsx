import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { InputNumber } from 'primereact/inputnumber'
import { Dropdown } from 'primereact/dropdown'
import { Message } from 'primereact/message'
import { AppDialog } from './AppDialog'
import { useApp } from '../app/AppContext'
import { errorMessage } from '../app/hooks'
import type { Currency, Reservation, ReservationInput, ReservationStatus, ReservationType, Trip } from '../types'
import { RESERVATION_STATUSES, RESERVATION_TYPES } from '../types'
import { DETAIL_KEYS, DETAIL_LABELS, validateReservation, type Errors } from '../utils/validation'
import { STATUS_LABEL, TYPE_LABEL } from '../utils/trips'

interface Props {
  visible: boolean
  onHide: () => void
  onSaved: (r: Reservation) => void
  /** Viaje fijo (desde el detalle del viaje) o lista para elegir. */
  trip?: Trip
  trips?: Trip[]
  /** Si viene, se edita. */
  reservation?: Reservation
}

const blank = (): ReservationInput => ({ type: 'FLIGHT', status: 'SIMULADA', provider: '', details: {}, price: 0, currency: 'COP' })

// Constante de modulo: un `[]` como valor por defecto seria un arreglo nuevo en cada render.
const NO_TRIPS: Trip[] = []

const DATE_KEYS = new Set(['checkIn', 'checkOut', 'date'])
const DATETIME_KEYS = new Set(['departureTime', 'arrivalTime'])

export function ReservationFormDialog({ visible, onHide, onSaved, trip, trips = NO_TRIPS, reservation }: Props) {
  const { resources, notify } = useApp()
  const [v, setV] = useState<ReservationInput>(blank())
  const [tripId, setTripId] = useState<string>('')
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // La lista de viajes solo se lee al abrir; que cambie de identidad no debe reiniciar lo que la persona ya escribio.
  const tripsRef = useRef(trips)
  tripsRef.current = trips

  useEffect(() => {
    if (!visible) return
    setErrors({})
    setServerError(null)
    if (reservation) {
      setV({ type: reservation.type, status: reservation.status, provider: reservation.provider, details: { ...reservation.details }, price: reservation.price, currency: reservation.currency })
      setTripId(reservation.tripId)
    } else {
      setV(blank())
      setTripId(trip?.tripId ?? tripsRef.current[0]?.tripId ?? '')
    }
  }, [visible, reservation, trip])

  const setDetail = (k: string, val: string) => setV((p) => ({ ...p, details: { ...p.details, [k]: val } }))

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy) return
    const details: Record<string, string> = {}
    for (const k of DETAIL_KEYS[v.type]) {
      const s = (v.details[k] ?? '').trim()
      if (s) details[k] = s
    }
    const body: ReservationInput = { ...v, provider: v.provider.trim(), details }
    const errs = validateReservation(body)
    if (!tripId) errs.tripId = 'Elige el viaje.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    setServerError(null)
    try {
      const saved = reservation
        ? await resources.updateReservation(reservation.tripId, reservation.resId, { status: body.status, provider: body.provider, details: body.details, price: body.price, currency: body.currency })
        : await resources.createReservation(tripId, body)
      notify('success', reservation ? 'Reserva actualizada.' : 'Reserva creada.')
      onSaved(saved)
    } catch (e) {
      setServerError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const err = (k: string) => errors[k] && <small className="field-error" role="alert">{errors[k]}</small>

  return (
    <AppDialog visible={visible} header={reservation ? 'Editar reserva' : 'Añadir reserva'} onHide={onHide} width="44rem">
      <form className="form grid-form" onSubmit={submit} noValidate>
        {serverError && <Message severity="error" text={serverError} className="span-2" />}
        <p className="muted span-2 no-card-note">Reserva simulada: no se realiza ningún cobro ni se piden datos de tarjeta.</p>

        {!reservation && !trip && (
          <div className="span-2">
            <label htmlFor="res-trip">Viaje</label>
            <Dropdown inputId="res-trip" value={tripId} options={trips.map((t) => ({ label: t.title, value: t.tripId }))} onChange={(e) => setTripId(e.value as string)} placeholder="Elige un viaje" />
            {err('tripId')}
          </div>
        )}
        <div>
          <label htmlFor="res-type">Tipo</label>
          <Dropdown
            inputId="res-type"
            value={v.type}
            disabled={!!reservation}
            options={RESERVATION_TYPES.map((t) => ({ label: TYPE_LABEL[t], value: t }))}
            onChange={(e) => setV((p) => ({ ...p, type: e.value as ReservationType, details: {} }))}
          />
        </div>
        <div>
          <label htmlFor="res-status">Estado</label>
          <Dropdown inputId="res-status" value={v.status} options={RESERVATION_STATUSES.map((s) => ({ label: STATUS_LABEL[s], value: s }))} onChange={(e) => setV((p) => ({ ...p, status: e.value as ReservationStatus }))} />
        </div>
        <div className="span-2">
          <label htmlFor="res-provider">Proveedor</label>
          <InputText id="res-provider" value={v.provider} onChange={(e) => setV((p) => ({ ...p, provider: e.target.value }))} />
          {err('provider')}
        </div>

        {DETAIL_KEYS[v.type].map((k) => (
          <div key={k} className={k === 'bookingUrl' ? 'span-2' : undefined}>
            <label htmlFor={`res-${k}`}>{DETAIL_LABELS[k]}</label>
            <InputText
              id={`res-${k}`}
              type={DATETIME_KEYS.has(k) ? 'datetime-local' : DATE_KEYS.has(k) ? 'date' : k === 'time' ? 'time' : k === 'bookingUrl' ? 'url' : 'text'}
              value={v.details[k] ?? ''}
              onChange={(e) => setDetail(k, e.target.value)}
              placeholder={k === 'bookingUrl' ? 'https://…' : undefined}
            />
            {err(`details.${k}`)}
          </div>
        ))}

        <div>
          <label htmlFor="res-price">Precio</label>
          <InputNumber inputId="res-price" value={v.price} onValueChange={(e) => setV((p) => ({ ...p, price: e.value ?? 0 }))} mode="decimal" locale="es-CO" minFractionDigits={0} maxFractionDigits={2} min={0} />
          {err('price')}
        </div>
        <div>
          <label htmlFor="res-currency">Moneda</label>
          <Dropdown inputId="res-currency" value={v.currency} options={['COP', 'USD'].map((c) => ({ label: c, value: c as Currency }))} onChange={(e) => setV((p) => ({ ...p, currency: e.value as Currency }))} />
        </div>

        <div className="dialog-actions span-2">
          <Button type="button" label="Cancelar" severity="secondary" outlined onClick={onHide} disabled={busy} />
          <Button type="submit" label={reservation ? 'Guardar cambios' : 'Añadir reserva'} loading={busy} />
        </div>
      </form>
    </AppDialog>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { InputNumber } from 'primereact/inputnumber'
import { InputTextarea } from 'primereact/inputtextarea'
import { Dropdown } from 'primereact/dropdown'
import { CityAutocomplete } from './CityAutocomplete'
import { Message } from 'primereact/message'
import { AppDialog } from './AppDialog'
import { useApp } from '../app/AppContext'
import { errorMessage } from '../app/hooks'
import type { Currency, Trip, TripInput } from '../types'
import { todayBogota } from '../utils/dates'
import { validateTrip, type Errors } from '../utils/validation'

interface Props {
  visible: boolean
  trip?: Trip
  onHide: () => void
  onSaved: (trip: Trip) => void
}

const EMPTY: TripInput = { title: '', origin: '', destination: '', startDate: '', endDate: '', travelers: 1, budget: 0, currency: 'COP', notes: '' }
const CURRENCIES: { label: string; value: Currency }[] = [
  { label: 'COP — peso colombiano', value: 'COP' },
  { label: 'USD — dólar', value: 'USD' },
]

export function TripFormDialog({ visible, trip, onHide, onSaved }: Props) {
  const { resources, notify } = useApp()
  const [v, setV] = useState<TripInput>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (visible) {
      setV(trip ? { title: trip.title, origin: trip.origin, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, budget: trip.budget, currency: trip.currency, notes: trip.notes ?? '' } : EMPTY)
      setErrors({})
      setServerError(null)
    }
  }, [visible, trip])

  const set = <K extends keyof TripInput>(k: K, val: TripInput[K]) => setV((p) => ({ ...p, [k]: val }))

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy) return
    const today = todayBogota()
    const errs = validateTrip(v, today, { checkStartFuture: !trip || v.startDate !== trip.startDate })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    setServerError(null)
    try {
      const clean: TripInput = { ...v, title: v.title.trim(), origin: v.origin.trim(), destination: v.destination.trim(), notes: (v.notes ?? '').trim() }
      let saved: Trip
      if (trip) {
        const patch: Record<string, unknown> = {}
        for (const k of Object.keys(clean) as (keyof TripInput)[]) {
          if ((clean[k] ?? '') !== (trip[k] ?? '')) patch[k] = clean[k]
        }
        saved = Object.keys(patch).length ? await resources.updateTrip(trip.tripId, patch) : trip
      } else {
        const body: TripInput = { ...clean }
        if (!body.notes) delete body.notes
        saved = await resources.createTrip(body)
      }
      notify('success', trip ? 'Viaje actualizado.' : 'Viaje creado.')
      onSaved(saved)
    } catch (e) {
      setServerError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const err = (k: string) => errors[k] && <small className="field-error" role="alert">{errors[k]}</small>

  return (
    <AppDialog visible={visible} header={trip ? 'Editar viaje' : 'Nuevo viaje'} onHide={onHide} width="44rem">
      <form className="form grid-form" onSubmit={submit} noValidate>
        {serverError && <Message severity="error" text={serverError} className="span-2" />}
        <div className="span-2">
          <label htmlFor="trip-title">Título</label>
          <InputText id="trip-title" value={v.title} onChange={(e) => set('title', e.target.value)} />
          {err('title')}
        </div>
        <div>
          <label htmlFor="trip-origin">Origen</label>
          <CityAutocomplete inputId="trip-origin" value={v.origin} onChange={(x) => set('origin', x)} invalid={!!errors.origin} />
          {err('origin')}
        </div>
        <div>
          <label htmlFor="trip-destination">Destino</label>
          <CityAutocomplete inputId="trip-destination" value={v.destination} onChange={(x) => set('destination', x)} invalid={!!errors.destination} />
          {err('destination')}
        </div>
        <p className="muted span-2 no-card-note city-credit">Datos de ciudades: GeoNames (CC BY 4.0)</p>
        <div>
          <label htmlFor="trip-start">Inicio</label>
          <InputText id="trip-start" type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />
          {err('startDate')}
        </div>
        <div>
          <label htmlFor="trip-end">Fin</label>
          <InputText id="trip-end" type="date" value={v.endDate} min={v.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} />
          {err('endDate')}
        </div>
        <div>
          <label htmlFor="trip-travelers">Viajeros</label>
          <InputNumber inputId="trip-travelers" value={v.travelers} onValueChange={(e) => set('travelers', e.value ?? 0)} min={1} max={20} useGrouping={false} />
          {err('travelers')}
        </div>
        <div>
          <label htmlFor="trip-currency">Moneda</label>
          <Dropdown inputId="trip-currency" value={v.currency} options={CURRENCIES} onChange={(e) => set('currency', e.value as Currency)} />
          {err('currency')}
        </div>
        <div className="span-2">
          <label htmlFor="trip-budget">Presupuesto</label>
          <InputNumber
            inputId="trip-budget"
            value={v.budget || null}
            onValueChange={(e) => set('budget', e.value ?? 0)}
            mode="decimal"
            locale="es-CO"
            minFractionDigits={0}
            maxFractionDigits={2}
            min={0}
          />
          {err('budget')}
        </div>
        <div className="span-2">
          <label htmlFor="trip-notes">Notas (opcional)</label>
          <InputTextarea id="trip-notes" rows={3} value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          {err('notes')}
        </div>
        <div className="dialog-actions span-2">
          <Button type="button" label="Cancelar" severity="secondary" outlined onClick={onHide} disabled={busy} />
          <Button type="submit" label={trip ? 'Guardar cambios' : 'Crear viaje'} loading={busy} />
        </div>
      </form>
    </AppDialog>
  )
}

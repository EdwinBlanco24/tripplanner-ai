import { useEffect, useState } from 'react'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Dropdown } from 'primereact/dropdown'
import { Message } from 'primereact/message'
import { AppDialog } from './AppDialog'
import type { ItemType, ItineraryDay, ItineraryItem } from '../types'
import { ITEM_TYPES } from '../types'
import { formatDateLong } from '../utils/dates'
import { validateDay, type Errors } from '../utils/validation'

const ITEM_LABEL: Record<ItemType, string> = {
  flight: 'Vuelo',
  hotel: 'Hotel',
  activity: 'Actividad',
  meal: 'Comida',
  transfer: 'Traslado',
  other: 'Otro',
}

interface Props {
  visible: boolean
  day: ItineraryDay | null
  saving: boolean
  error: string | null
  onHide: () => void
  onSave: (day: ItineraryDay) => void
}

const blankItem = (): ItineraryItem => ({ time: '09:00', title: '', type: 'activity', location: '', notes: '' })

export function sortItems(items: ItineraryItem[]): ItineraryItem[] {
  return [...items].sort((a, b) => a.time.localeCompare(b.time))
}

export function DayEditorDialog({ visible, day, saving, error, onHide, onSave }: Props) {
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [errors, setErrors] = useState<Errors>({})

  useEffect(() => {
    if (visible && day) {
      setItems(day.items.map((i) => ({ ...i })))
      setErrors({})
    }
  }, [visible, day])

  if (!day) return null

  const update = (i: number, patch: Partial<ItineraryItem>) => setItems((p) => p.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const move = (i: number, dir: -1 | 1) =>
    setItems((p) => {
      const j = i + dir
      if (j < 0 || j >= p.length) return p
      const next = [...p]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const remove = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i))

  const save = () => {
    const cleaned = items.map((it) => {
      const out: ItineraryItem = { time: it.time, title: it.title.trim(), type: it.type }
      if (it.location?.trim()) out.location = it.location.trim()
      if (it.notes?.trim()) out.notes = it.notes.trim()
      return out
    })
    const next: ItineraryDay = { ...day, items: cleaned }
    const errs = validateDay(next)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    onSave(next)
  }

  return (
    <AppDialog visible={visible} header={`Editar día · ${formatDateLong(day.date)}`} onHide={onHide} width="52rem">
      <div className="form">
        {error && <Message severity="error" text={error} />}
        {errors.items && <small className="field-error" role="alert">{errors.items}</small>}
        {items.length === 0 && <p className="muted">Este día no tiene actividades.</p>}
        <ol className="day-items">
          {items.map((it, i) => (
            <li key={i} className="day-item">
              <div className="day-item-row">
                <div>
                  <label htmlFor={`di-time-${i}`}>Hora</label>
                  <InputText id={`di-time-${i}`} type="time" value={it.time} onChange={(e) => update(i, { time: e.target.value })} />
                  {errors[`item.${i}.time`] && <small className="field-error" role="alert">{errors[`item.${i}.time`]}</small>}
                </div>
                <div className="grow">
                  <label htmlFor={`di-title-${i}`}>Título</label>
                  <InputText id={`di-title-${i}`} value={it.title} onChange={(e) => update(i, { title: e.target.value })} />
                  {errors[`item.${i}.title`] && <small className="field-error" role="alert">{errors[`item.${i}.title`]}</small>}
                </div>
                <div>
                  <label htmlFor={`di-type-${i}`}>Tipo</label>
                  <Dropdown inputId={`di-type-${i}`} value={it.type} options={ITEM_TYPES.map((t) => ({ label: ITEM_LABEL[t], value: t }))} onChange={(e) => update(i, { type: e.value as ItemType })} />
                </div>
              </div>
              <div className="day-item-row">
                <div className="grow">
                  <label htmlFor={`di-loc-${i}`}>Lugar</label>
                  <InputText id={`di-loc-${i}`} value={it.location ?? ''} onChange={(e) => update(i, { location: e.target.value })} />
                </div>
                <div className="grow">
                  <label htmlFor={`di-notes-${i}`}>Notas</label>
                  <InputText id={`di-notes-${i}`} value={it.notes ?? ''} onChange={(e) => update(i, { notes: e.target.value })} />
                </div>
                <div className="item-actions">
                  <Button type="button" icon="pi pi-arrow-up" text rounded aria-label={`Subir actividad ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button type="button" icon="pi pi-arrow-down" text rounded aria-label={`Bajar actividad ${i + 1}`} disabled={i === items.length - 1} onClick={() => move(i, 1)} />
                  <Button type="button" icon="pi pi-trash" text rounded severity="danger" aria-label={`Quitar actividad ${i + 1}`} onClick={() => remove(i)} />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="dialog-actions between">
          <div>
            <Button type="button" label="Añadir actividad" icon="pi pi-plus" outlined onClick={() => setItems((p) => [...p, blankItem()])} disabled={items.length >= 30} />
            <Button type="button" label="Ordenar por hora" icon="pi pi-sort-amount-down" text onClick={() => setItems((p) => sortItems(p))} />
          </div>
          <div>
            <Button type="button" label="Cancelar" severity="secondary" outlined onClick={onHide} disabled={saving} />
            <Button type="button" label="Guardar día" onClick={save} loading={saving} />
          </div>
        </div>
      </div>
    </AppDialog>
  )
}

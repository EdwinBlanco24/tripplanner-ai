import { useState } from 'react'
import { Button } from 'primereact/button'
import { InputTextarea } from 'primereact/inputtextarea'
import { Skeleton } from 'primereact/skeleton'
import { useApp } from '../app/AppContext'
import { errorMessage, useLoad } from '../app/hooks'
import { EmptyState } from '../components/EmptyState'
import {
  BUDGET_OPTIONS,
  DEFAULT_PREFERENCES,
  FLIGHT_TIME_OPTIONS,
  MAX_NOTES,
  PACE_OPTIONS,
  parsePreferences,
  STYLE_OPTIONS,
  toRequestBody,
  type Preferences as Prefs,
} from '../utils/preferences'

interface SegmentedProps<T extends string> {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

/** Grupo de botones segmentados: una sola opcion activa (aria-pressed), accesible con teclado. */
function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="pref-group" role="group" aria-label={label}>
      <span className="pref-label">{label}</span>
      <div className="segmented">
        {options.map((o) => (
          <button key={o.value} type="button" className={`segment ${value === o.value ? 'on' : ''}`} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** /preferencias: estilos de viaje, ritmo, horario de vuelo, nivel de presupuesto y notas. */
export function Preferences() {
  const { resources } = useApp()
  const { data, loading, error, reload } = useLoad(async () => parsePreferences(await resources.getPreferences()), [resources])

  if (loading) {
    return (
      <section aria-busy="true" aria-label="Cargando">
        <Skeleton height="2.5rem" width="40%" className="mb" />
        <Skeleton height="16rem" />
      </section>
    )
  }
  if (error) {
    return (
      <section>
        <div className="card">
          <EmptyState icon="pi-exclamation-triangle" title="No pudimos cargar tus preferencias.">
            <Button label="Reintentar" icon="pi pi-refresh" onClick={reload} />
          </EmptyState>
        </div>
      </section>
    )
  }
  return <PreferencesForm initial={data ?? DEFAULT_PREFERENCES} />
}

function PreferencesForm({ initial }: { initial: Prefs }) {
  const { resources, notify, invalidateData } = useApp()
  const [form, setForm] = useState<Prefs>(initial)
  const [saving, setSaving] = useState(false)

  const toggleStyle = (v: Prefs['travelStyles'][number]) =>
    setForm((f) => ({ ...f, travelStyles: f.travelStyles.includes(v) ? f.travelStyles.filter((s) => s !== v) : [...f.travelStyles, v] }))

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await resources.savePreferences(toRequestBody(form))
      notify('success', 'Preferencias guardadas')
      invalidateData() // el Dashboard y el asistente releen sus datos
    } catch (e) {
      notify('error', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="preferences-page">
      <div className="page-head">
        <h1>Mis preferencias</h1>
      </div>
      <p className="muted">El asistente las usa para recomendarte actividades y vuelos. Puedes cambiarlas cuando quieras.</p>
      <div className="card form">
        <div className="pref-group" role="group" aria-label="Estilos de viaje">
          <span className="pref-label">Estilos de viaje</span>
          <div className="chips-row">
            {STYLE_OPTIONS.map((o) => {
              const on = form.travelStyles.includes(o.value)
              return (
                <button key={o.value} type="button" className={`pref-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleStyle(o.value)}>
                  <i className={`pi ${o.icon}`} aria-hidden="true" /> {o.label}
                </button>
              )
            })}
          </div>
        </div>
        <Segmented label="Ritmo del viaje" options={PACE_OPTIONS} value={form.pace} onChange={(pace) => setForm((f) => ({ ...f, pace }))} />
        <Segmented label="Horario de vuelo" options={FLIGHT_TIME_OPTIONS} value={form.flightTime} onChange={(flightTime) => setForm((f) => ({ ...f, flightTime }))} />
        <Segmented label="Nivel de presupuesto" options={BUDGET_OPTIONS} value={form.budgetLevel} onChange={(budgetLevel) => setForm((f) => ({ ...f, budgetLevel }))} />
        <div className="pref-group">
          <label htmlFor="pref-notes" className="pref-label">
            Notas (opcional)
          </label>
          <InputTextarea id="pref-notes" rows={3} value={form.notes} maxLength={MAX_NOTES} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Ej.: prefiero hoteles tranquilos y vuelos sin escalas" />
          <small className="muted pref-count" aria-live="polite">
            {form.notes.length}/{MAX_NOTES}
          </small>
          <small className="muted">No escribas datos de tarjetas ni de pago.</small>
        </div>
        <div className="dialog-actions">
          <Button label="Restablecer" icon="pi pi-undo" outlined severity="secondary" onClick={() => setForm(DEFAULT_PREFERENCES)} disabled={saving} />
          <Button label="Guardar" icon="pi pi-check" loading={saving} onClick={save} />
        </div>
      </div>
    </section>
  )
}

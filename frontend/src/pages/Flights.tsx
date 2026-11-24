import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { Panel } from 'primereact/panel'
import { useApp, useOwnConversation } from '../app/AppContext'
import { BAND_OPTIONS, composeFlightSearch, composeReserveMessage, lastTripId, type TimeBand } from '../agent/messages'
import { parseFlights, type Flight } from '../agent/uiData'
import { useConversation } from '../agent/useConversation'
import { FlightCards } from '../agent/ui/Cards'
import { ProgressLines } from '../agent/ui/ChatPanel'
import { SafeMarkdown } from '../agent/ui/SafeMarkdown'
import { CityAutocomplete } from '../components/CityAutocomplete'
import { todayBogota } from '../utils/dates'
import { validateFlightSearch } from '../utils/searchValidation'
import type { Errors } from '../utils/validation'

/** /vuelos: formulario que consulta al Orquestador (sesion propia de la pagina) y muestra SOLO las tarjetas de vuelos. */
export function Flights() {
  const { assistant } = useApp()
  const conv = useOwnConversation()
  const state = useConversation(conv)
  const navigate = useNavigate()
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [date, setDate] = useState('')
  const [passengers, setPassengers] = useState<number | null>(1)
  const [band, setBand] = useState<TimeBand>('any')
  const [errors, setErrors] = useState<Errors>({})

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (state.running) return
    const errs = validateFlightSearch({ origin, destination, date, passengers }, todayBogota())
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    conv.reset() // cada busqueda parte limpia (los resultados anteriores no se mezclan)
    void conv.send(composeFlightSearch({ origin: origin.trim(), destination: destination.trim(), date, band, passengers: passengers ?? 1 }))
  }

  const reserve = (f: Flight) => {
    const msg = composeReserveMessage(f, lastTripId(assistant.getState().uiHistory))
    void assistant.send(msg)
    navigate('/asistente')
  }

  const flights = state.uiLatest.flights ? parseFlights(state.uiLatest.flights.data) : null
  const fullText = state.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.text : '')).join('\n\n')
  const err = (k: string) => errors[k] && <small className="field-error" role="alert">{errors[k]}</small>

  return (
    <section>
      <div className="page-head">
        <h1>Vuelos</h1>
        <Link to="/asistente">
          <Button label="Continuar en el asistente" icon="pi pi-comments" outlined />
        </Link>
      </div>
      <form className="card form grid-form" onSubmit={submit} noValidate>
        <div>
          <label htmlFor="fl-origin">Origen</label>
          <CityAutocomplete inputId="fl-origin" value={origin} onChange={setOrigin} invalid={!!errors.origin} />
          {err('origin')}
        </div>
        <div>
          <label htmlFor="fl-destination">Destino</label>
          <CityAutocomplete inputId="fl-destination" value={destination} onChange={setDestination} invalid={!!errors.destination} />
          {err('destination')}
        </div>
        <div>
          <label htmlFor="fl-date">Fecha</label>
          <InputText id="fl-date" type="date" value={date} min={todayBogota()} onChange={(e) => setDate(e.target.value)} />
          {err('date')}
        </div>
        <div>
          <label htmlFor="fl-passengers">Pasajeros</label>
          <InputNumber inputId="fl-passengers" value={passengers} onValueChange={(e) => setPassengers(e.value ?? null)} min={1} max={9} useGrouping={false} />
          {err('passengers')}
        </div>
        <div>
          <label htmlFor="fl-band">Franja horaria</label>
          <Dropdown inputId="fl-band" value={band} options={BAND_OPTIONS} onChange={(e) => setBand(e.value as TimeBand)} />
        </div>
        <div className="dialog-actions">
          <Button type="submit" label="Buscar vuelos" icon="pi pi-search" loading={state.running} />
          {state.running && <Button type="button" label="Detener" icon="pi pi-stop" severity="danger" outlined onClick={conv.stop} />}
        </div>
      </form>

      <ProgressLines state={state} onRetry={() => void conv.retry()} />
      {flights && <FlightCards flights={flights} onReserve={reserve} busy={state.running} />}
      {fullText && (
        <Panel header="Ver respuesta completa" toggleable collapsed className="mb">
          <SafeMarkdown text={fullText} />
        </Panel>
      )}
    </section>
  )
}

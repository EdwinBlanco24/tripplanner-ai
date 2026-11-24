import { useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Panel } from 'primereact/panel'
import { useApp, useOwnConversation } from '../app/AppContext'
import { composeWeatherQuery } from '../agent/messages'
import { parseWeather } from '../agent/uiData'
import { useConversation } from '../agent/useConversation'
import { WeatherCards } from '../agent/ui/Cards'
import { ProgressLines } from '../agent/ui/ChatPanel'
import { SafeMarkdown } from '../agent/ui/SafeMarkdown'
import { ContinueBlock } from '../agent/ui/ContinueBlock'
import { useContinueInAssistant } from '../agent/ui/useContinueInAssistant'
import { continuePrompt } from '../agent/continuePrompt'
import { CityAutocomplete } from '../components/CityAutocomplete'
import { errorMessage } from '../app/hooks'
import { addDays, formatDate, todayBogota } from '../utils/dates'
import { forecastHorizon, MAX_FORECAST_DAYS, validateWeatherQuery } from '../utils/searchValidation'
import { selectNextTrip } from '../utils/trips'
import type { Errors } from '../utils/validation'

/** /clima: formulario de ciudad y fechas (maximo 16 dias desde hoy); muestra tarjetas por dia. */
export function Weather() {
  const { resources, notify } = useApp()
  const conv = useOwnConversation()
  const state = useConversation(conv)
  const [city, setCity] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const { requestContinue, dialog } = useContinueInAssistant(conv)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [loadingTrip, setLoadingTrip] = useState(false)
  const today = todayBogota()

  const ask = (c: string, s: string, e: string) => {
    setDismissed(null)
    conv.reset()
    void conv.send(composeWeatherQuery(c.trim(), s, e))
  }

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (state.running) return
    const errs = validateWeatherQuery({ city, start, end }, today)
    setErrors(errs)
    if (Object.keys(errs).length === 0) ask(city, start, end)
  }

  const nextTrip = async () => {
    if (state.running || loadingTrip) return
    setLoadingTrip(true)
    try {
      const trip = selectNextTrip(await resources.listTrips('PLANNED'), today)
      if (!trip) {
        notify('info', 'No tienes viajes próximos con fecha futura.')
        return
      }
      if (trip.startDate > forecastHorizon(today)) {
        notify('warn', `Tu próximo viaje empieza el ${formatDate(trip.startDate)}: el pronóstico solo llega hasta el ${formatDate(forecastHorizon(today))}.`)
        return
      }
      const from = trip.startDate < today ? today : trip.startDate
      const to = [trip.endDate, forecastHorizon(today), addDays(from, MAX_FORECAST_DAYS - 1)].sort()[0]
      setCity(trip.destination)
      setStart(from)
      setEnd(to)
      setErrors({})
      ask(trip.destination, from, to)
    } catch (e) {
      notify('error', errorMessage(e))
    } finally {
      setLoadingTrip(false)
    }
  }

  const prompt = continuePrompt(state)
  const showContinue = prompt !== null && prompt.textId !== dismissed
  const weather = state.uiLatest.weather ? parseWeather(state.uiLatest.weather.data) : null
  const fullText = state.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.text : '')).join('\n\n')
  const err = (k: string) => errors[k] && <small className="field-error" role="alert">{errors[k]}</small>

  return (
    <section>
      <div className="page-head">
        <h1>Clima</h1>
        <div className="head-actions">
          <Button label="Clima de mi próximo viaje" icon="pi pi-sun" outlined onClick={nextTrip} loading={loadingTrip} disabled={state.running} />
          <Button label="Continuar en el asistente" icon="pi pi-comments" outlined onClick={requestContinue} />
        </div>
      </div>
      <form className="card form grid-form" onSubmit={submit} noValidate>
        <div className="span-2">
          <label htmlFor="wx-city">Ciudad</label>
          <CityAutocomplete inputId="wx-city" value={city} onChange={setCity} invalid={!!errors.city} />
          {err('city')}
        </div>
        <div>
          <label htmlFor="wx-start">Desde</label>
          <InputText id="wx-start" type="date" value={start} min={today} max={forecastHorizon(today)} onChange={(e) => setStart(e.target.value)} />
          {err('start')}
        </div>
        <div>
          <label htmlFor="wx-end">Hasta</label>
          <InputText id="wx-end" type="date" value={end} min={start || today} max={forecastHorizon(today)} onChange={(e) => setEnd(e.target.value)} />
          {err('end')}
        </div>
        <p className="muted span-2 no-card-note">El pronóstico cubre desde hoy hasta el {formatDate(forecastHorizon(today))} (máximo 16 días).</p>
        <div className="dialog-actions span-2">
          <Button type="submit" label="Consultar clima" icon="pi pi-search" loading={state.running} />
          {state.running && <Button type="button" label="Detener" icon="pi pi-stop" severity="danger" outlined onClick={conv.stop} />}
        </div>
      </form>

      <ProgressLines state={state} onRetry={() => void conv.retry()} />
      {weather && <WeatherCards weather={weather} />}
      {showContinue && prompt && <ContinueBlock prompt={prompt} onContinue={requestContinue} onDiscard={() => setDismissed(prompt.textId)} />}
      {fullText && (
        <Panel header="Ver respuesta completa" toggleable collapsed className="mb">
          <SafeMarkdown text={fullText} />
        </Panel>
      )}
      {dialog}
    </section>
  )
}

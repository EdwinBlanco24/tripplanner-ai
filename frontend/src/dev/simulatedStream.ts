import type { StreamLike } from '../agent/conversation'
import type { AgentEvent } from '../agent/events'

/** Solo desarrollo: stream simulado con los datos de TripPlannerA2A/fixtures (vuelos reales BOG-CTG del 04/12/2026). */
export const SIM_FLIGHTS = {
  flights: [
    { airline: 'Wingo', flightNumber: 'P57216', origin: 'BOG', destination: 'CTG', departureTime: '2026-12-04T06:35', arrivalTime: '2026-12-04T08:07', durationMinutes: 92, stops: 0, price: 398, currency: 'USD', bookingUrl: 'https://kiwi.com/u/yu5uwzgvp4' },
    { airline: 'JetSMART', flightNumber: 'JA5131', origin: 'BOG', destination: 'CTG', departureTime: '2026-12-04T06:50', arrivalTime: '2026-12-04T10:01', durationMinutes: 191, stops: 1, price: 511, currency: 'USD', bookingUrl: 'https://kiwi.com/u/jxvz6ngg52' },
    { airline: 'LATAM Airlines', flightNumber: 'LA4106', origin: 'BOG', destination: 'CTG', departureTime: '2026-12-04T07:15', arrivalTime: '2026-12-04T08:50', durationMinutes: 95, stops: 0, price: 520, currency: 'USD', bookingUrl: 'https://kiwi.com/u/latam4106' },
  ],
}

export const SIM_WEATHER = {
  weather: {
    location: 'Cartagena de Indias, Departamento de Bolívar, Colombia',
    days: [
      { date: '2026-12-04', weekday: 'viernes', tempMax: 32.3, tempMin: 27.6, condition: 'Llovizna ligera', rainProbability: 83 },
      { date: '2026-12-05', weekday: 'sábado', tempMax: 33, tempMin: 26.5, condition: 'Parcialmente nublado', rainProbability: 40 },
      { date: '2026-12-06', weekday: 'domingo', tempMax: 32.8, tempMin: 26.9, condition: 'Mayormente despejado', rainProbability: 15 },
      { date: '2026-12-07', weekday: 'lunes', tempMax: 32.1, tempMin: 27.2, condition: 'Nublado', rainProbability: 55 },
    ],
  },
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })

const WIDE_TABLE =
  '| Fecha | Día | Máx | Mín | Lluvia | Condición |\n|---|---|---|---|---|---|\n' +
  '| 2026-12-04 | viernes | 32 | 27 | 83% | Llovizna ligera |\n| 2026-12-05 | sábado | 33 | 26 | 40% | Parcialmente nublado |\n' +
  '| 2026-12-06 | domingo | 33 | 27 | 15% | Mayormente despejado |\n'

/** ?mode=tabla: respuesta con tabla de 6 columnas. ?mode=breve: respuesta corta de 2 a 4 frases con lienzo. */
export function createSimulatedStream(delay = 150, mode: 'normal' | 'tabla' | 'breve' = 'normal'): StreamLike {
  return {
    async stream(_prompt, _sessionId, signal, onEvent) {
      const mid: AgentEvent[] =
        mode === 'tabla'
          ? [{ type: 'ui', component: 'weather', data: SIM_WEATHER }, { type: 'text', delta: 'Este es el pronóstico:\n\n' + WIDE_TABLE }, { type: 'done' }]
          : mode === 'breve'
            ? [
                { type: 'status', agent: 'flights', message: 'Consultando el agente de vuelos…' },
                { type: 'ui', component: 'flights', data: SIM_FLIGHTS },
                { type: 'text', delta: 'La opción más conveniente es la directa de Wingo (P57216), a las 06:35. Los detalles están en la pestaña **Vuelos** del lienzo. ¿Quieres que registre una reserva simulada?' },
                { type: 'done' },
              ]
            : []
      const script: AgentEvent[] = mid.length ? mid : [
        { type: 'status', agent: 'flights', message: 'Consultando el agente de vuelos…' },
        { type: 'ui', component: 'flights', data: SIM_FLIGHTS },
        { type: 'text', delta: 'Encontré 3 opciones para el **viernes 4 de diciembre**:\n\n' },
        { type: 'text', delta: '| Aerolínea | Vuelo | Salida | Precio |\n|---|---|---|---|\n| Wingo | P57216 | 06:35 | 398 USD |\n| JetSMART | JA5131 | 06:50 | 511 USD |\n\n' },
        { type: 'text', delta: 'La más barata es **Wingo**, directa. [Ver en Kiwi](https://kiwi.com/u/yu5uwzgvp4)' },
        { type: 'status', agent: 'weather', message: 'Consultando el clima…' },
        { type: 'ui', component: 'weather', data: SIM_WEATHER },
        { type: 'text', delta: 'El viernes habrá llovizna ligera; lleva paraguas.' },
        { type: 'done' },
      ]
      for (const ev of script) {
        await wait(delay, signal)
        if (signal.aborted) return { status: 'aborted' }
        onEvent(ev)
      }
      return { status: 'done' }
    },
  }
}

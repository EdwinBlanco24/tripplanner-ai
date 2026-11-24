import type { AgentEvent } from './events'
import { initialConversation, reduce, type ConversationAction, type ConversationState } from './reducer'
import { SessionTracker, type SessionSnapshot } from './session'
import type { StreamOutcome } from './streamClient'

export const ROLLOVER_NOTICE = 'Retomamos en una sesión nueva; tus viajes siguen guardados.'
export const LOST_MESSAGE = 'Se perdió la conexión.'
export const MSG_UNAUTHORIZED = 'Tu sesión expiró. Inicia sesión de nuevo.'
export const MSG_FORBIDDEN = 'No tienes permiso para usar el asistente.'
export const MSG_SERVER = 'El asistente no está disponible en este momento. Inténtalo de nuevo más tarde.'

/** Componentes cuyo cambio invalida los datos del canal 1 (Dashboard, Mis viajes, Reservas). */
export const WRITING_COMPONENTS = new Set(['trip', 'trips', 'itinerary', 'reservations'])

export interface StreamLike {
  stream(prompt: string, sessionId: string, signal: AbortSignal, onEvent: (e: AgentEvent) => void): Promise<StreamOutcome>
}

export interface ConversationDeps {
  client: StreamLike
  sessions?: SessionTracker
  /** Se llama cuando el asistente escribio datos (ui de viajes/itinerarios/reservas o tools de negocio). */
  onDataChanged?: () => void
}

/** Todo lo necesario para seguir una conversacion en otra pagina: mensajes, resultados y la MISMA sesion de AgentCore. */
export interface ConversationSnapshot {
  state: ConversationState
  session: SessionSnapshot
  lastPrompt: string
}

/** Conversacion con el asistente: estado (reducer) + envio, detener, reintentar y sesion. Usable con useSyncExternalStore. */
export class Conversation {
  private state: ConversationState = initialConversation
  private listeners = new Set<() => void>()
  private abort: AbortController | null = null
  private lastPrompt = ''
  private readonly sessions: SessionTracker
  private readonly client: StreamLike
  private readonly onDataChanged?: () => void

  constructor(deps: ConversationDeps) {
    this.client = deps.client
    this.sessions = deps.sessions ?? new SessionTracker()
    this.onDataChanged = deps.onDataChanged
  }

  getState = (): ConversationState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private dispatch(action: ConversationAction): void {
    this.state = reduce(this.state, action)
    this.listeners.forEach((l) => l())
  }

  /** Envia un mensaje (visible en el chat). Ignora vacios y envios mientras hay uno en curso. */
  send = async (text: string): Promise<void> => {
    const prompt = text.trim()
    if (!prompt || this.state.running) return
    this.lastPrompt = prompt
    const prep = this.sessions.prepare()
    this.dispatch({ type: 'send', text: prompt })
    if (prep.rolled) this.dispatch({ type: 'notice', text: ROLLOVER_NOTICE })
    await this.run(prompt, prep.id)
  }

  /** Reintentar tras "Se perdio la conexion": mismo texto, sesion nueva, sin duplicar el mensaje de la persona. */
  retry = async (): Promise<void> => {
    if (this.state.running || !this.lastPrompt) return
    const id = this.sessions.renew()
    this.dispatch({ type: 'retry-start' })
    await this.run(this.lastPrompt, id)
  }

  stop = (): void => {
    this.abort?.abort()
  }

  /** Copia de la conversacion (sin respuesta en curso) y de su sesion, para transferirla. */
  snapshot = (): ConversationSnapshot => ({
    state: reduce(this.state, { type: 'finish' }),
    session: this.sessions.snapshot(),
    lastPrompt: this.lastPrompt,
  })

  /** Reemplaza esta conversacion por la transferida; sigue en la misma sesion (si pasaron >14 min, el siguiente envio abre otra). */
  adopt = (snap: ConversationSnapshot): void => {
    this.abort?.abort()
    this.sessions.restore(snap.session)
    this.lastPrompt = snap.lastPrompt
    this.dispatch({ type: 'replace', state: snap.state })
  }

  /** Nueva conversacion: borra el chat y los resultados y abre otra sesion. */
  reset = (): void => {
    this.abort?.abort()
    this.sessions.renew()
    this.lastPrompt = ''
    this.dispatch({ type: 'reset' })
  }

  private async run(prompt: string, sessionId: string): Promise<void> {
    const controller = new AbortController()
    this.abort = controller
    let businessTouched = false
    const outcome = await this.client.stream(prompt, sessionId, controller.signal, (ev) => {
      this.sessions.touch()
      if (ev.type === 'status' && ev.agent === 'business') businessTouched = true
      this.dispatch({ type: 'event', event: ev })
      if (ev.type === 'ui' && WRITING_COMPONENTS.has(ev.component)) this.onDataChanged?.()
    })
    if (this.abort === controller) this.abort = null
    switch (outcome.status) {
      case 'done':
        if (businessTouched) this.onDataChanged?.()
        this.dispatch({ type: 'finish' })
        break
      case 'aborted':
        this.dispatch({ type: 'finish' })
        break
      case 'lost':
        this.dispatch({ type: 'lost', prompt })
        break
      case 'unauthorized':
        this.dispatch({ type: 'failed', message: MSG_UNAUTHORIZED })
        break
      case 'forbidden':
        this.dispatch({ type: 'failed', message: MSG_FORBIDDEN })
        break
      case 'server':
        this.dispatch({ type: 'failed', message: MSG_SERVER })
        break
    }
  }
}

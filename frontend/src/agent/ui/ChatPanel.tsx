import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from 'primereact/button'
import { InputTextarea } from 'primereact/inputtextarea'
import type { ChatItem, ConversationState } from '../reducer'
import { SafeMarkdown } from './SafeMarkdown'

export const SUGGESTIONS = [
  'Quiero organizar unas vacaciones de cuatro días en Cartagena. Salgo desde Bogotá, viajo con dos personas más y tengo un presupuesto de 5 millones de pesos. Quiero conocer el clima, encontrar vuelos y organizar algunas actividades turísticas',
  '¿Qué clima hará en mi próximo viaje?',
  'Muéstrame mis reservas',
]

const AGENT_LABEL: Record<string, string> = { flights: 'Vuelos', weather: 'Clima', business: 'Viajes', orchestrator: 'Asistente' }

interface Props {
  state: ConversationState
  onSend: (text: string) => void
  onStop: () => void
  onReset: () => void
  onRetry: () => void
}

function StatusLine({ item }: { item: Extract<ChatItem, { kind: 'status' }> }) {
  return (
    <div className="chat-status" role="status">
      {item.done ? <i className="pi pi-check" aria-label="Listo" /> : <i className="pi pi-spin pi-spinner" aria-label="En curso" />}
      <span className="chat-status-agent">{AGENT_LABEL[item.agent] ?? item.agent}</span>
      <span>{item.message}</span>
    </div>
  )
}

/** Lineas de progreso y errores de una conversacion (para las paginas Vuelos y Clima, que no muestran el chat). */
export function ProgressLines({ state, onRetry }: { state: ConversationState; onRetry: () => void }) {
  return (
    <div className="progress-lines">
      {state.items.map((item) => {
        if (item.kind === 'status') return <StatusLine key={item.id} item={item} />
        if (item.kind === 'error')
          return (
            <div key={item.id} className="chat-error" role="alert">
              <i className="pi pi-exclamation-triangle" aria-hidden="true" /> {item.message}
            </div>
          )
        if (item.kind === 'lost')
          return (
            <div key={item.id} className="chat-error" role="alert">
              <i className="pi pi-wifi" aria-hidden="true" /> Se perdió la conexión.{' '}
              <Button label="Reintentar" icon="pi pi-replay" size="small" outlined onClick={onRetry} disabled={state.running} />
            </div>
          )
        if (item.kind === 'notice')
          return (
            <div key={item.id} className="chat-notice" role="status">
              {item.text}
            </div>
          )
        return null
      })}
    </div>
  )
}

/** Chat: burbujas, Markdown seguro, status con spinner y ✓, y entrada con Enter / Shift+Enter. */
export function ChatPanel({ state, onSend, onStop, onReset, onRetry }: Props) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Autoscroll solo si la persona esta al final: si subio a leer, no se le mueve.
  const onScroll = () => {
    const el = listRef.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }
  useEffect(() => {
    const el = listRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [state.items])

  const send = () => {
    const text = draft.trim()
    if (!text || state.running) return
    pinned.current = true
    setDraft('')
    onSend(text)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <section className="chat" aria-label="Chat con el asistente">
      <div className="chat-head">
        <h2>Asistente</h2>
        <Button label="Nueva conversación" icon="pi pi-refresh" text size="small" onClick={onReset} />
      </div>
      <div className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite">
        {state.items.length === 0 && (
          <div className="chat-empty">
            <p className="muted">Cuéntame qué viaje quieres planear. Puedo buscar vuelos, consultar el clima y guardar tus viajes y reservas.</p>
            <div className="chips-row">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => onSend(s)} disabled={state.running}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.items.map((item) => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="bubble bubble-user">
                  {item.text}
                </div>
              )
            case 'text':
              return (
                <div key={item.id} className="bubble bubble-assistant">
                  <SafeMarkdown text={item.text} />
                </div>
              )
            case 'status':
              return <StatusLine key={item.id} item={item} />
            case 'error':
              return (
                <div key={item.id} className="chat-error" role="alert">
                  <i className="pi pi-exclamation-triangle" aria-hidden="true" /> {item.message}
                </div>
              )
            case 'notice':
              return (
                <div key={item.id} className="chat-notice" role="status">
                  {item.text}
                </div>
              )
            case 'lost':
              return (
                <div key={item.id} className="chat-error" role="alert">
                  <i className="pi pi-wifi" aria-hidden="true" /> Se perdió la conexión.{' '}
                  <Button label="Reintentar" icon="pi pi-replay" size="small" outlined onClick={onRetry} disabled={state.running} />
                </div>
              )
          }
        })}
      </div>
      <div className="chat-input">
        <InputTextarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          autoResize
          placeholder="Escribe tu mensaje… (Enter envía, Shift+Enter nueva línea)"
          aria-label="Mensaje para el asistente"
          maxLength={4000}
        />
        {state.running ? (
          <Button icon="pi pi-stop" severity="danger" aria-label="Detener" tooltip="Detener" onClick={onStop} />
        ) : (
          <Button icon="pi pi-send" aria-label="Enviar" tooltip="Enviar" onClick={send} disabled={!draft.trim()} />
        )}
      </div>
    </section>
  )
}

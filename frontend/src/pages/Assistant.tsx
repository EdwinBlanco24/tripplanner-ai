import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { composeReserveMessage, lastTripId } from '../agent/messages'
import { useConversation } from '../agent/useConversation'
import { ChatPanel } from '../agent/ui/ChatPanel'
import { Canvas } from '../agent/ui/Canvas'
import type { Flight } from '../agent/uiData'

/** /asistente: chat a la izquierda (~420 px) y lienzo a la derecha; en movil, pestanas Chat | Resultados. */
export function Assistant() {
  const { assistant } = useApp()
  const state = useConversation(assistant)
  const [pane, setPane] = useState<'chat' | 'results'>('chat')
  const [newResults, setNewResults] = useState(false)

  const reserve = (f: Flight) => {
    void assistant.send(composeReserveMessage(f, lastTripId(state.uiHistory)))
    setPane('chat')
  }

  return (
    <section className="assistant-page">
      <div className="mobile-tabs" role="tablist" aria-label="Chat o resultados">
        <button type="button" role="tab" aria-selected={pane === 'chat'} className={pane === 'chat' ? 'active' : ''} onClick={() => setPane('chat')}>
          Chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === 'results'}
          className={pane === 'results' ? 'active' : ''}
          onClick={() => {
            setPane('results')
            setNewResults(false)
          }}
        >
          Resultados
          {newResults && pane !== 'results' && <span className="new-dot" aria-label="Resultados nuevos" />}
        </button>
      </div>
      <div className={`assistant-grid pane-${pane}`}>
        <div className="assistant-chat">
          <ChatPanel state={state} onSend={(t) => void assistant.send(t)} onStop={assistant.stop} onReset={assistant.reset} onRetry={() => void assistant.retry()} />
        </div>
        <div className="assistant-canvas">
          <Canvas state={state} onReserve={reserve} onNewData={() => setNewResults(true)} />
        </div>
      </div>
    </section>
  )
}

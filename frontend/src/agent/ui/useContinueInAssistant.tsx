import { useCallback, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/AppContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { Conversation } from '../conversation'

/**
 * Transfiere la conversacion de una pagina (Vuelos, Clima) al Asistente y navega a /asistente.
 * Si el Asistente ya tiene mensajes pide confirmacion antes de reemplazarlos.
 */
export function useContinueInAssistant(conv: Conversation): { requestContinue: () => void; dialog: ReactNode } {
  const { assistant } = useApp()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  const transfer = useCallback(() => {
    const snap = conv.snapshot()
    conv.stop()
    assistant.adopt(snap)
    setConfirming(false)
    navigate('/asistente')
  }, [conv, assistant, navigate])

  const requestContinue = useCallback(() => {
    if (conv.getState().items.length === 0) {
      navigate('/asistente') // nada que transferir
      return
    }
    if (assistant.getState().items.length > 0) setConfirming(true)
    else transfer()
  }, [conv, assistant, navigate, transfer])

  const dialog = (
    <ConfirmDialog visible={confirming} title="¿Reemplazar la conversación actual del asistente?" confirmLabel="Reemplazar" onConfirm={transfer} onCancel={() => setConfirming(false)}>
      <p>El asistente ya tiene una conversación. Si continúas, se reemplaza por la de esta página y la anterior no se podrá recuperar.</p>
    </ConfirmDialog>
  )
  return { requestContinue, dialog }
}

import { useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { quickActions } from '../quickActions'
import type { ConversationState } from '../reducer'

/** Barra de acciones rapidas contextual (encima de las pestanas del lienzo). Se desactiva mientras el asistente responde. */
export function QuickActions({ state, onSend }: { state: ConversationState; onSend: (text: string) => void }) {
  const navigate = useNavigate()
  const actions = quickActions(state)
  if (actions.length === 0) return null
  return (
    <div className="quick-actions" role="toolbar" aria-label="Acciones rápidas">
      {actions.map((a) => {
        if (a.kind === 'hint')
          return (
            <span key={a.id} className="quick-hint">
              <i className="pi pi-info-circle" aria-hidden="true" /> {a.label}
            </span>
          )
        return (
          <Button
            key={a.id}
            label={a.label}
            icon={a.kind === 'link' ? 'pi pi-arrow-right' : 'pi pi-bolt'}
            size="small"
            outlined={a.kind === 'link'}
            disabled={state.running}
            onClick={() => (a.kind === 'send' ? onSend(a.message) : navigate(a.to))}
          />
        )
      })}
    </div>
  )
}

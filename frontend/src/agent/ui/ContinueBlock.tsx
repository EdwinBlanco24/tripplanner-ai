import { Button } from 'primereact/button'
import type { ContinuePrompt } from '../continuePrompt'

interface Props {
  prompt: ContinuePrompt
  onContinue: () => void
  onDiscard: () => void
}

/** Bajo las tarjetas de Vuelos/Clima: la ultima pregunta del asistente y como responderla en el asistente. */
export function ContinueBlock({ prompt, onContinue, onDiscard }: Props) {
  return (
    <section className="continue-block" aria-label="Continuar con el asistente">
      <p className="continue-question">{prompt.question}</p>
      <div className="dialog-actions">
        <Button label="Sí, continuar en el asistente" icon="pi pi-comments" onClick={onContinue} />
        <Button label="No, descartar" icon="pi pi-times" severity="secondary" outlined onClick={onDiscard} />
      </div>
    </section>
  )
}

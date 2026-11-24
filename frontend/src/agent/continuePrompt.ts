import type { ChatItem, ConversationState } from './reducer'

export const DEFAULT_QUESTION = '¿Quieres seguir con el asistente?'

/** Ultimo segmento de texto del asistente, si es lo ultimo que dijo (ignorando lineas de progreso). */
export function lastAssistantText(items: ChatItem[]): Extract<ChatItem, { kind: 'text' }> | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'status') continue
    return it.kind === 'text' && it.text.trim() ? it : null
  }
  return null
}

/** Si el texto termina en "?", la ultima frase (con su ¿ de apertura); si no, null. Quita el formato Markdown de los extremos. */
export function lastQuestion(text: string): string | null {
  const t = text.trim().replace(/[\s*_`)"'”»]+$/, '')
  if (!t.endsWith('?')) return null
  const body = t.slice(0, -1)
  let start = Math.max(body.lastIndexOf('.'), body.lastIndexOf('!'), body.lastIndexOf('?'), body.lastIndexOf('\n')) + 1
  const open = body.lastIndexOf('¿')
  if (open >= start) start = open
  const sentence = body.slice(start).replace(/^[\s*_`#>\-•]+/, '').replace(/\*\*|__/g, '').trim()
  return sentence ? `${sentence}?` : null
}

export interface ContinuePrompt {
  /** Id del segmento de texto: sirve para recordar que la persona ya descarto este bloque. */
  textId: number
  question: string
}

/** Bloque "Continuar en el asistente": solo con la respuesta terminada y con texto. */
export function continuePrompt(state: ConversationState): ContinuePrompt | null {
  if (state.running) return null
  const text = lastAssistantText(state.items)
  if (!text) return null
  return { textId: text.id, question: lastQuestion(text.text) ?? DEFAULT_QUESTION }
}

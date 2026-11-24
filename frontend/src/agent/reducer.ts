import type { AgentEvent } from './events'

export type ChatItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'text'; text: string }
  | { id: number; kind: 'status'; agent: string; message: string; done: boolean }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'notice'; text: string }
  /** Se perdio la conexion: guarda el texto que se reenvia con "Reintentar". */
  | { id: number; kind: 'lost'; prompt: string }

export interface UiEntry {
  /** Orden de llegada (creciente): sirve para saber si hay algo nuevo en una pestana. */
  seq: number
  component: string
  data: unknown
}

export interface ConversationState {
  items: ChatItem[]
  running: boolean
  /** true si el ultimo evento fue texto: el siguiente delta se pega al mismo segmento. */
  textOpen: boolean
  nextId: number
  /** Ultimo componente de cada tipo, y el historial completo. */
  uiLatest: Record<string, UiEntry>
  uiHistory: UiEntry[]
  uiSeq: number
}

export const initialConversation: ConversationState = {
  items: [],
  running: false,
  textOpen: false,
  nextId: 1,
  uiLatest: {},
  uiHistory: [],
  uiSeq: 0,
}

export type ConversationAction =
  | { type: 'send'; text: string }
  | { type: 'retry-start' }
  | { type: 'event'; event: AgentEvent }
  | { type: 'notice'; text: string }
  | { type: 'lost'; prompt: string }
  | { type: 'failed'; message: string }
  | { type: 'finish' }
  | { type: 'reset' }

function markDone(items: ChatItem[]): ChatItem[] {
  return items.some((i) => i.kind === 'status' && !i.done) ? items.map((i) => (i.kind === 'status' && !i.done ? { ...i, done: true } : i)) : items
}

type NewItem = ChatItem extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never

function push(state: ConversationState, item: NewItem, patch: Partial<ConversationState> = {}): ConversationState {
  return { ...state, ...patch, items: [...state.items, { ...item, id: state.nextId } as ChatItem], nextId: state.nextId + 1 }
}

export function reduce(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case 'send':
      return push(state, { kind: 'user', text: action.text }, { running: true, textOpen: false })
    case 'retry-start':
      return { ...state, items: state.items.filter((i) => i.kind !== 'lost'), running: true, textOpen: false }
    case 'notice':
      return push(state, { kind: 'notice', text: action.text }, { textOpen: false })
    case 'lost':
      return push({ ...state, items: markDone(state.items) }, { kind: 'lost', prompt: action.prompt }, { running: false, textOpen: false })
    case 'failed':
      return push({ ...state, items: markDone(state.items) }, { kind: 'error', message: action.message }, { running: false, textOpen: false })
    case 'finish':
      return { ...state, items: markDone(state.items), running: false, textOpen: false }
    case 'reset':
      return initialConversation
    case 'event': {
      const ev = action.event
      const base = { ...state, items: markDone(state.items) }
      switch (ev.type) {
        case 'text': {
          if (!ev.delta) return state
          const last = base.items[base.items.length - 1]
          if (state.textOpen && last && last.kind === 'text') {
            const items = base.items.slice(0, -1)
            items.push({ ...last, text: last.text + ev.delta })
            return { ...base, items }
          }
          return push(base, { kind: 'text', text: ev.delta }, { textOpen: true })
        }
        case 'status':
          return push(base, { kind: 'status', agent: ev.agent, message: ev.message, done: false }, { textOpen: false })
        case 'ui': {
          const entry: UiEntry = { seq: state.uiSeq + 1, component: ev.component, data: ev.data }
          return {
            ...base,
            textOpen: false,
            uiSeq: entry.seq,
            uiLatest: { ...state.uiLatest, [ev.component]: entry },
            uiHistory: [...state.uiHistory, entry],
          }
        }
        case 'error':
          return push(base, { kind: 'error', message: ev.message }, { textOpen: false })
        case 'done':
          return { ...base, running: false, textOpen: false }
      }
    }
  }
}

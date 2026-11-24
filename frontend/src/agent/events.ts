/** Contrato del stream (docs/04-tools-agentes.md seccion 4): status | text | ui | error | done. */
export type AgentEvent =
  | { type: 'status'; agent: string; message: string }
  | { type: 'text'; delta: string }
  | { type: 'ui'; component: string; data: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' }

/** Convierte el JSON de un evento al tipo conocido; devuelve null si no es un evento reconocible (se ignora). */
export function toAgentEvent(raw: unknown): AgentEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  switch (e.type) {
    case 'text':
      return typeof e.delta === 'string' ? { type: 'text', delta: e.delta } : null
    case 'status':
      return { type: 'status', agent: typeof e.agent === 'string' ? e.agent : 'orchestrator', message: typeof e.message === 'string' ? e.message : '' }
    case 'ui':
      return typeof e.component === 'string' && e.component ? { type: 'ui', component: e.component, data: e.data } : null
    case 'error':
      return { type: 'error', message: typeof e.message === 'string' && e.message ? e.message : 'Ocurrió un error al procesar tu solicitud.' }
    case 'done':
      return { type: 'done' }
    default:
      return null
  }
}

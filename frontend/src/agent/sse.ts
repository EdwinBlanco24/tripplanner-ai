import { toAgentEvent, type AgentEvent } from './events'

/**
 * Parser SSE (mismo comportamiento que spike/agentcore-stream.html): acumula hasta la linea en blanco, normaliza CRLF,
 * soporta eventos partidos entre chunks y varios eventos por chunk, e ignora las lineas que no son `data:`.
 */
export class SseParser {
  private buffer = ''

  /** Entrega los eventos completos que ya se pueden leer. */
  push(piece: string): AgentEvent[] {
    this.buffer = (this.buffer + piece).replace(/\r\n/g, '\n')
    const out: AgentEvent[] = []
    let idx: number
    while ((idx = this.buffer.indexOf('\n\n')) >= 0) {
      const ev = parseBlock(this.buffer.slice(0, idx))
      this.buffer = this.buffer.slice(idx + 2)
      if (ev) out.push(ev)
    }
    return out
  }

  /** Al cerrar el stream: lo que quede sin linea en blanco final tambien cuenta como un bloque. */
  flush(): AgentEvent[] {
    const rest = this.buffer.replace(/\r\n/g, '\n').trim()
    this.buffer = ''
    if (!rest) return []
    const ev = parseBlock(rest)
    return ev ? [ev] : []
  }
}

export function parseBlock(block: string): AgentEvent | null {
  const lines = block.split('\n').filter((l) => l.startsWith('data:'))
  if (lines.length === 0) return null
  const data = lines.map((l) => l.slice(5).replace(/^ /, '')).join('\n')
  try {
    return toAgentEvent(JSON.parse(data))
  } catch {
    return null
  }
}

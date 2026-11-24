import { SseParser } from './sse'
import type { AgentEvent } from './events'

export const REFRESH_BEFORE_MS = 5 * 60 * 1000
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'

export interface StreamAuth {
  getAccessToken(): string | null
  readonly tokenExpiresAt: number
  refresh(): Promise<boolean>
}

export interface StreamClientDeps {
  region: string
  runtimeArn: string
  auth: StreamAuth
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Como termino un envio. 'done' = llego el evento done; el resto son fallos que la pantalla traduce a texto. */
export type StreamOutcome =
  | { status: 'done' }
  | { status: 'aborted' }
  | { status: 'lost' } // red o stream cerrado sin done
  | { status: 'unauthorized' } // 401 tras refrescar
  | { status: 'forbidden' } // 403
  | { status: 'server'; code: number } // 5xx u otro HTTP inesperado

/** URL de invocacion: el ARN va codificado en la ruta y el host sale SOLO de la region configurada. */
export function invocationUrl(region: string, runtimeArn: string): string {
  if (!/^[a-z0-9-]+$/.test(region)) throw new Error('region invalida')
  if (!runtimeArn) throw new Error('falta el ARN del orquestador')
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(runtimeArn)}/invocations?qualifier=DEFAULT`
}

export function createStreamClient(deps: StreamClientDeps) {
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const now = deps.now ?? (() => Date.now())
  const url = invocationUrl(deps.region, deps.runtimeArn)

  async function freshToken(): Promise<string | null> {
    if (!deps.auth.getAccessToken() || deps.auth.tokenExpiresAt - now() < REFRESH_BEFORE_MS) {
      if (!(await deps.auth.refresh())) return null
    }
    return deps.auth.getAccessToken()
  }

  function post(token: string, prompt: string, sessionId: string, signal: AbortSignal): Promise<Response> {
    return doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        [SESSION_HEADER]: sessionId,
      },
      body: JSON.stringify({ prompt }),
      signal,
    })
  }

  /** Envia el prompt y entrega cada evento a onEvent. Nunca lanza: devuelve como termino. */
  async function stream(prompt: string, sessionId: string, signal: AbortSignal, onEvent: (e: AgentEvent) => void): Promise<StreamOutcome> {
    try {
      let token = await freshToken()
      if (!token) return { status: 'unauthorized' }
      if (signal.aborted) return { status: 'aborted' }
      let res = await post(token, prompt, sessionId, signal)
      if (res.status === 401) {
        if (!(await deps.auth.refresh())) return { status: 'unauthorized' }
        token = deps.auth.getAccessToken()
        if (!token) return { status: 'unauthorized' }
        res = await post(token, prompt, sessionId, signal)
        if (res.status === 401) return { status: 'unauthorized' }
      }
      if (res.status === 403) return { status: 'forbidden' }
      if (!res.ok) return { status: 'server', code: res.status }
      if (!res.body) return { status: 'lost' }

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      const parser = new SseParser()
      let sawDone = false
      const deliver = (events: AgentEvent[]) => {
        for (const ev of events) {
          if (ev.type === 'done') sawDone = true
          onEvent(ev)
        }
      }
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        deliver(parser.push(decoder.decode(value, { stream: true })))
      }
      deliver(parser.push(decoder.decode()))
      deliver(parser.flush())
      return sawDone ? { status: 'done' } : { status: 'lost' }
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return { status: 'aborted' }
      return { status: 'lost' }
    }
  }

  return { stream, url }
}

export type StreamClient = ReturnType<typeof createStreamClient>

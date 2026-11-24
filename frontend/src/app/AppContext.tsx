import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Toast } from 'primereact/toast'
import { AuthManager } from '../auth/authManager'
import { createCognitoApi } from '../auth/cognito'
import { createApiClient } from '../api/client'
import { createResources, type Resources } from '../api/resources'
import { getConfig } from '../config/config'
import { Conversation, type StreamLike } from '../agent/conversation'
import { createStreamClient } from '../agent/streamClient'

export interface Services {
  auth: AuthManager
  resources: Resources
  /** Canal 2: streaming directo a AgentCore. Opcional para que las pruebas y el sandbox puedan simularlo. */
  stream?: StreamLike
}

export function buildServices(auth?: AuthManager): Services {
  const cfg = getConfig()
  const manager = auth ?? new AuthManager({ cognito: createCognitoApi() })
  const api = createApiClient({
    baseUrl: cfg.apiUrl,
    getToken: () => manager.getAccessToken(),
    refresh: () => manager.refresh(),
    onUnauthorized: () => manager.signOut(),
  })
  const stream = createStreamClient({ region: cfg.region, runtimeArn: cfg.orchestratorRuntimeArn, auth: manager })
  return { auth: manager, resources: createResources(api), stream }
}

type Severity = 'success' | 'info' | 'warn' | 'error'

interface AppContextValue extends Services {
  signedIn: boolean
  restoring: boolean
  email: string | null
  notify: (severity: Severity, detail: string) => void
  /** Sube al cambiar datos por el chat: las pantallas del canal 1 que la usan en sus dependencias se recargan. */
  dataVersion: number
  invalidateData: () => void
  /** Conversacion principal del Asistente (vive mientras dure la sesion de la pagina). */
  assistant: Conversation
  /** Cliente de streaming para conversaciones propias (Vuelos, Clima). */
  stream: StreamLike
}

const NO_STREAM: StreamLike = { stream: async () => ({ status: 'lost' }) }

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ services, children }: { services: Services; children: ReactNode }) {
  const toast = useRef<Toast>(null)
  const [signedIn, setSignedIn] = useState(services.auth.isSignedIn())
  const [restoring, setRestoring] = useState(services.auth.hasStoredSession() && !services.auth.isSignedIn())
  const [email, setEmail] = useState<string | null>(services.auth.email)

  useEffect(() => {
    const off = services.auth.subscribe((v) => {
      setSignedIn(v)
      setEmail(services.auth.email)
    })
    let cancelled = false
    if (services.auth.hasStoredSession() && !services.auth.isSignedIn()) {
      void services.auth.restore().finally(() => {
        if (!cancelled) {
          setEmail(services.auth.email)
          setRestoring(false)
        }
      })
    } else {
      setRestoring(false)
    }
    return () => {
      cancelled = true
      off()
    }
  }, [services.auth])

  const [dataVersion, setDataVersion] = useState(0)
  const invalidateData = useCallback(() => setDataVersion((v) => v + 1), [])
  const stream = services.stream ?? NO_STREAM
  const assistant = useMemo(() => new Conversation({ client: stream, onDataChanged: invalidateData }), [stream, invalidateData])

  const notify = useCallback((severity: Severity, detail: string) => {
    const summary = { success: 'Listo', info: 'Información', warn: 'Atención', error: 'Algo salió mal' }[severity]
    toast.current?.show({ severity, summary, detail, life: severity === 'error' ? 6000 : 3500 })
  }, [])

  const value = useMemo(
    () => ({ ...services, stream, signedIn, restoring, email, notify, dataVersion, invalidateData, assistant }),
    [services, stream, signedIn, restoring, email, notify, dataVersion, invalidateData, assistant],
  )
  return (
    <Ctx.Provider value={value}>
      <Toast ref={toast} position="top-right" />
      {children}
    </Ctx.Provider>
  )
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp fuera de AppProvider')
  return v
}

/** Conversacion propia de una pagina (Vuelos, Clima): sesion y resultados separados de los del Asistente. */
export function useOwnConversation(): Conversation {
  const { stream, invalidateData } = useApp()
  const ref = useRef<Conversation | null>(null)
  if (ref.current === null) ref.current = new Conversation({ client: stream, onDataChanged: invalidateData })
  return ref.current
}

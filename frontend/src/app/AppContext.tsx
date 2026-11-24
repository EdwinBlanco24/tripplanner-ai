import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Toast } from 'primereact/toast'
import { AuthManager } from '../auth/authManager'
import { createCognitoApi } from '../auth/cognito'
import { createApiClient } from '../api/client'
import { createResources, type Resources } from '../api/resources'
import { getConfig } from '../config/config'

export interface Services {
  auth: AuthManager
  resources: Resources
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
  return { auth: manager, resources: createResources(api) }
}

type Severity = 'success' | 'info' | 'warn' | 'error'

interface AppContextValue extends Services {
  signedIn: boolean
  restoring: boolean
  email: string | null
  notify: (severity: Severity, detail: string) => void
}

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

  const notify = useCallback((severity: Severity, detail: string) => {
    const summary = { success: 'Listo', info: 'Información', warn: 'Atención', error: 'Algo salió mal' }[severity]
    toast.current?.show({ severity, summary, detail, life: severity === 'error' ? 6000 : 3500 })
  }, [])

  const value = useMemo(() => ({ ...services, signedIn, restoring, email, notify }), [services, signedIn, restoring, email, notify])
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

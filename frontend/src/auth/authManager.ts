import type { AuthResult, CognitoApi } from './cognito'

export const REFRESH_KEY = 'tp.refreshToken'
export const EMAIL_KEY = 'tp.email'
/** Se renueva el access token unos 5 min antes de que expire. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000

export type AuthListener = (signedIn: boolean) => void

interface Deps {
  cognito: CognitoApi
  storage?: Storage
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const part = idToken.split('.')[1]
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))
    const email = (JSON.parse(json) as { email?: unknown }).email
    return typeof email === 'string' ? email : null
  } catch {
    return null
  }
}

/**
 * Sesion: el access token vive SOLO en memoria; el refresh token en sessionStorage.
 * Un fallo al refrescar cierra la sesion.
 */
export class AuthManager {
  private accessToken: string | null = null
  private expiresAt = 0
  private timer: unknown = null
  private inflight: Promise<boolean> | null = null
  private listeners = new Set<AuthListener>()
  private readonly cognito: CognitoApi
  private readonly storage: Storage
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (id: unknown) => void

  constructor(deps: Deps) {
    this.cognito = deps.cognito
    this.storage = deps.storage ?? sessionStorage
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
  }

  subscribe(fn: AuthListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    const signedIn = this.isSignedIn()
    this.listeners.forEach((l) => l(signedIn))
  }

  isSignedIn(): boolean {
    return this.accessToken !== null
  }

  get email(): string | null {
    return this.storage.getItem(EMAIL_KEY)
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  hasStoredSession(): boolean {
    return this.storage.getItem(REFRESH_KEY) !== null
  }

  private apply(result: AuthResult): void {
    this.accessToken = result.AccessToken
    this.expiresAt = this.now() + result.ExpiresIn * 1000
    if (result.RefreshToken) this.storage.setItem(REFRESH_KEY, result.RefreshToken)
    this.schedule(result.ExpiresIn * 1000)
  }

  private schedule(lifetimeMs: number): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    const delay = lifetimeMs > REFRESH_MARGIN_MS * 2 ? lifetimeMs - REFRESH_MARGIN_MS : Math.max(lifetimeMs / 2, 1000)
    this.timer = this.setTimer(() => {
      void this.refresh()
    }, delay)
  }

  async signIn(email: string, password: string): Promise<void> {
    const result = await this.cognito.signIn(email, password)
    this.apply(result)
    const fromToken = emailFromIdToken(result.IdToken)
    this.storage.setItem(EMAIL_KEY, fromToken ?? email)
    this.emit()
  }

  /** Intenta recuperar la sesion con el refresh token guardado (al recargar la pagina). */
  async restore(): Promise<boolean> {
    if (!this.hasStoredSession()) return false
    return this.refresh()
  }

  /** Renueva el access token. Una sola peticion a la vez. Si falla, cierra la sesion y devuelve false. */
  refresh(): Promise<boolean> {
    if (this.inflight) return this.inflight
    const refreshToken = this.storage.getItem(REFRESH_KEY)
    if (!refreshToken) {
      this.signOut()
      return Promise.resolve(false)
    }
    this.inflight = this.cognito
      .refresh(refreshToken)
      .then((result) => {
        this.apply(result)
        this.emit()
        return true
      })
      .catch(() => {
        this.signOut()
        return false
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  signOut(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.accessToken = null
    this.expiresAt = 0
    this.storage.removeItem(REFRESH_KEY)
    this.storage.removeItem(EMAIL_KEY)
    this.emit()
  }

  /** Para pruebas. */
  get tokenExpiresAt(): number {
    return this.expiresAt
  }
}

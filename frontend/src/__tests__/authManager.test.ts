import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthManager, EMAIL_KEY, REFRESH_KEY, REFRESH_MARGIN_MS } from '../auth/authManager'
import { CognitoError, type CognitoApi } from '../auth/cognito'

function fakeCognito(over: Partial<CognitoApi> = {}): CognitoApi {
  return {
    signUp: vi.fn(),
    confirmSignUp: vi.fn(),
    resendCode: vi.fn(),
    signIn: vi.fn(async () => ({ AccessToken: 'access-1', RefreshToken: 'refresh-1', ExpiresIn: 3600 })),
    refresh: vi.fn(async () => ({ AccessToken: 'access-2', ExpiresIn: 3600 })),
    ...over,
  }
}

describe('AuthManager', () => {
  beforeEach(() => sessionStorage.clear())

  it('guarda el access token en memoria y el refresh token en sessionStorage', async () => {
    const m = new AuthManager({ cognito: fakeCognito(), setTimer: () => 1, clearTimer: () => {} })
    await m.signIn('a@b.co', 'x')
    expect(m.getAccessToken()).toBe('access-1')
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-1')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('access-1')
    expect(localStorage.length).toBe(0)
    expect(m.email).toBe('a@b.co')
  })

  it('programa la renovacion 5 min antes de expirar', async () => {
    const setTimer = vi.fn(() => 1)
    const m = new AuthManager({ cognito: fakeCognito(), setTimer, clearTimer: () => {} })
    await m.signIn('a@b.co', 'x')
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 3600 * 1000 - REFRESH_MARGIN_MS)
  })

  it('al dispararse el temporizador refresca y conserva el refresh token', async () => {
    let fire: () => void = () => {}
    const cognito = fakeCognito()
    const m = new AuthManager({
      cognito,
      setTimer: (fn) => {
        fire = fn
        return 1
      },
      clearTimer: () => {},
    })
    await m.signIn('a@b.co', 'x')
    fire()
    await vi.waitFor(() => expect(m.getAccessToken()).toBe('access-2'))
    expect(cognito.refresh).toHaveBeenCalledWith('refresh-1')
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-1')
  })

  it('un fallo al refrescar cierra la sesion y limpia todo', async () => {
    const cognito = fakeCognito({
      refresh: vi.fn(async () => {
        throw new CognitoError('NotAuthorizedException', 'x')
      }),
    })
    const m = new AuthManager({ cognito, setTimer: () => 1, clearTimer: () => {} })
    const events: boolean[] = []
    m.subscribe((s) => events.push(s))
    await m.signIn('a@b.co', 'x')
    expect(await m.refresh()).toBe(false)
    expect(m.isSignedIn()).toBe(false)
    expect(m.getAccessToken()).toBeNull()
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(sessionStorage.getItem(EMAIL_KEY)).toBeNull()
    expect(events.at(-1)).toBe(false)
  })

  it('peticiones de refresco simultaneas comparten una sola llamada', async () => {
    const cognito = fakeCognito()
    const m = new AuthManager({ cognito, setTimer: () => 1, clearTimer: () => {} })
    await m.signIn('a@b.co', 'x')
    await Promise.all([m.refresh(), m.refresh(), m.refresh()])
    expect(cognito.refresh).toHaveBeenCalledTimes(1)
  })

  it('restore recupera la sesion tras recargar usando el refresh token', async () => {
    sessionStorage.setItem(REFRESH_KEY, 'refresh-9')
    const cognito = fakeCognito()
    const m = new AuthManager({ cognito, setTimer: () => 1, clearTimer: () => {} })
    expect(m.isSignedIn()).toBe(false)
    expect(await m.restore()).toBe(true)
    expect(m.getAccessToken()).toBe('access-2')
    expect(cognito.refresh).toHaveBeenCalledWith('refresh-9')
  })

  it('restore sin sesion guardada no llama a Cognito', async () => {
    const cognito = fakeCognito()
    const m = new AuthManager({ cognito, setTimer: () => 1, clearTimer: () => {} })
    expect(await m.restore()).toBe(false)
    expect(cognito.refresh).not.toHaveBeenCalled()
  })

  it('signOut limpia memoria, almacenamiento y temporizador', async () => {
    const clearTimer = vi.fn()
    const m = new AuthManager({ cognito: fakeCognito(), setTimer: () => 7, clearTimer })
    await m.signIn('a@b.co', 'x')
    m.signOut()
    expect(m.getAccessToken()).toBeNull()
    expect(sessionStorage.length).toBe(0)
    expect(clearTimer).toHaveBeenCalledWith(7)
  })
})

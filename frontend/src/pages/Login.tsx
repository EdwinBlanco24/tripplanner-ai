import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { Message } from 'primereact/message'
import { useApp } from '../app/AppContext'
import { createCognitoApi, CognitoError, type CognitoApi } from '../auth/cognito'
import { isEmail } from '../utils/validation'
import { CodeInput } from './login/CodeInput'
import { FloatingField } from './login/FloatingField'
import { usePrefersReducedMotion } from './login/motion'
import { isStrongEnough, passwordChecks, passwordStrength } from './login/passwordRules'
import { Showcase } from './login/Showcase'
import '../styles/login.css'

type Tab = 'login' | 'register' | 'confirm'

const cognito: CognitoApi = createCognitoApi()

function msg(e: unknown): string {
  return e instanceof CognitoError ? e.message : 'No pudimos completar la operación. Inténtalo de nuevo.'
}

export function Login({ api = cognito }: { api?: CognitoApi }) {
  const { auth, signedIn, notify } = useApp()
  const navigate = useNavigate()
  const reduced = usePrefersReducedMotion()
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [caps, setCaps] = useState(false)
  const [shake, setShake] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tras confirmar la cuenta se muestra un check animado un instante y se pasa a iniciar sesion.
  useEffect(() => {
    if (!confirmed) return
    const t = setTimeout(
      () => {
        setConfirmed(false)
        setTab('login')
        setInfo('Cuenta confirmada. Ya puedes iniciar sesión.')
      },
      reduced ? 600 : 1500,
    )
    return () => clearTimeout(t)
  }, [confirmed, reduced])

  useEffect(
    () => () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current)
    },
    [],
  )

  if (signedIn) return <Navigate to="/" replace />

  const fail = (text: string) => {
    setError(text)
    if (reduced) return
    setShake(true)
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShake(false), 500)
  }

  const go = (t: Tab) => {
    setTab(t)
    setError(null)
    setInfo(null)
  }

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await fn()
    } catch (e) {
      fail(msg(e))
      // Cuenta sin confirmar: se lleva directo a confirmar el codigo.
      if (e instanceof CognitoError && e.code === 'UserNotConfirmedException') setTab('confirm')
    } finally {
      setBusy(false)
    }
  }

  const validateEmail = (): boolean => {
    if (!isEmail(email)) {
      fail('Escribe un correo válido.')
      return false
    }
    return true
  }

  const onLogin = (ev: FormEvent) => {
    ev.preventDefault()
    if (!validateEmail()) return
    if (!password) return fail('Escribe tu contraseña.')
    void run(async () => {
      await auth.signIn(email.trim().toLowerCase(), password)
      setPassword('')
      navigate('/', { replace: true })
    })
  }

  const onRegister = (ev: FormEvent) => {
    ev.preventDefault()
    if (!validateEmail()) return
    if (!isStrongEnough(password)) return fail('La contraseña debe tener mínimo 8 caracteres, con mayúscula, minúscula y número.')
    void run(async () => {
      await api.signUp(email.trim().toLowerCase(), password)
      setPassword('')
      setCode('')
      setTab('confirm')
      setInfo('Te enviamos un código de verificación por correo. Ingrésalo para activar tu cuenta.')
    })
  }

  const onConfirm = (ev: FormEvent) => {
    ev.preventDefault()
    if (!validateEmail()) return
    if (!/^\d{6}$/.test(code.trim())) return fail('El código tiene 6 dígitos.')
    void run(async () => {
      await api.confirmSignUp(email.trim().toLowerCase(), code.trim())
      setCode('')
      setInfo(null)
      setConfirmed(true)
    })
  }

  const onResend = () => {
    if (!validateEmail()) return
    void run(async () => {
      await api.resendCode(email.trim().toLowerCase())
      notify('info', 'Te enviamos un nuevo código.')
      setInfo('Te enviamos un nuevo código por correo.')
    })
  }

  const checks = passwordChecks(password)
  const strength = passwordStrength(password)

  return (
    <div className="login-page" data-reduced-motion={reduced ? 'true' : 'false'}>
      <Showcase reduced={reduced} />
      <main className="login-panel">
        <div className={`login-card ${shake ? 'shake' : ''}`}>
          <h2 className="login-brand">
            <i className="pi pi-send" aria-hidden="true" /> TripPlanner AI
          </h2>
          <div className="tabs" role="tablist">
            {(
              [
                ['login', 'Entrar'],
                ['register', 'Crear cuenta'],
                ['confirm', 'Confirmar código'],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => go(t)}>
                {label}
              </button>
            ))}
          </div>

          <div className="live-region" aria-live="polite" aria-atomic="true">
            {error && <Message severity="error" text={error} className="form-message" />}
            {info && <Message severity="success" text={info} className="form-message" />}
          </div>

          {confirmed ? (
            <div className="confirmed" role="status">
              <svg viewBox="0 0 52 52" className="check-anim" aria-hidden="true">
                <circle cx="26" cy="26" r="24" fill="none" stroke="#166534" strokeWidth="3" className="check-circle" />
                <path d="M14 27 l8 8 l16 -17" fill="none" stroke="#166534" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="check-mark" />
              </svg>
              <p>¡Cuenta confirmada!</p>
            </div>
          ) : (
            <form key={tab} onSubmit={tab === 'login' ? onLogin : tab === 'register' ? onRegister : onConfirm} className="login-form panel-enter" noValidate>
              <FloatingField id="email" label="Correo electrónico" type="email" autoComplete="email" value={email} onChange={setEmail} />

              {tab !== 'confirm' && (
                <>
                  <FloatingField
                    id="password"
                    label="Contraseña"
                    type="password"
                    autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={setPassword}
                    onCapsLock={setCaps}
                    describedBy={tab === 'register' ? 'pass-rules' : undefined}
                  />
                  {caps && (
                    <small className="caps-warning" role="status">
                      <i className="pi pi-exclamation-triangle" aria-hidden="true" /> Bloq Mayús está activado.
                    </small>
                  )}
                </>
              )}

              {tab === 'register' && (
                <div id="pass-rules" className="pass-rules">
                  <ul aria-label="Requisitos de la contraseña">
                    {checks.map((c) => (
                      <li key={c.id} className={c.ok ? 'ok' : ''} data-ok={c.ok}>
                        <span aria-hidden="true">{c.ok ? '✓' : '○'}</span> {c.label}
                        <span className="sr-only">{c.ok ? ' (cumplido)' : ' (pendiente)'}</span>
                      </li>
                    ))}
                  </ul>
                  <div
                    className={`strength strength-${strength.level}`}
                    role="progressbar"
                    aria-label="Fortaleza de la contraseña"
                    aria-valuemin={0}
                    aria-valuemax={4}
                    aria-valuenow={strength.score}
                    aria-valuetext={strength.label || 'Sin contraseña'}
                  >
                    <span style={{ width: `${(strength.score / 4) * 100}%` }} />
                  </div>
                  <small className="strength-label">{strength.label}</small>
                </div>
              )}

              {tab === 'confirm' && (
                <>
                  <p className="muted code-help">Escribe el código de 6 dígitos que te enviamos por correo.</p>
                  <CodeInput value={code} onChange={setCode} disabled={busy} />
                  <Button type="button" label="Reenviar código" text onClick={onResend} disabled={busy} className="link-button" />
                </>
              )}

              <Button
                type="submit"
                loading={busy}
                className="login-submit"
                label={tab === 'login' ? 'Entrar' : tab === 'register' ? 'Crear cuenta' : 'Confirmar cuenta'}
              />
            </form>
          )}
          <p className="evaluator-note muted">¿Evaluador? Usa la cuenta indicada en la entrega o crea una nueva.</p>
        </div>
      </main>
    </div>
  )
}

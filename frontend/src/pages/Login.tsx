import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Password } from 'primereact/password'
import { Message } from 'primereact/message'
import { useApp } from '../app/AppContext'
import { createCognitoApi, CognitoError, type CognitoApi } from '../auth/cognito'
import { isEmail } from '../utils/validation'

type Tab = 'login' | 'register' | 'confirm'

const cognito: CognitoApi = createCognitoApi()

function msg(e: unknown): string {
  return e instanceof CognitoError ? e.message : 'No pudimos completar la operación. Inténtalo de nuevo.'
}

export function Login({ api = cognito }: { api?: CognitoApi }) {
  const { auth, signedIn, notify } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (signedIn) return <Navigate to="/" replace />

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
      setError(msg(e))
      // Cuenta sin confirmar: se lleva directo a confirmar el codigo.
      if (e instanceof CognitoError && e.code === 'UserNotConfirmedException') setTab('confirm')
    } finally {
      setBusy(false)
    }
  }

  const validateEmail = (): boolean => {
    if (!isEmail(email)) {
      setError('Escribe un correo válido.')
      return false
    }
    return true
  }

  const onLogin = (ev: FormEvent) => {
    ev.preventDefault()
    if (!validateEmail()) return
    if (!password) return setError('Escribe tu contraseña.')
    void run(async () => {
      await auth.signIn(email.trim().toLowerCase(), password)
      setPassword('')
      navigate('/', { replace: true })
    })
  }

  const onRegister = (ev: FormEvent) => {
    ev.preventDefault()
    if (!validateEmail()) return
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))
      return setError('La contraseña debe tener mínimo 8 caracteres, con mayúscula, minúscula y número.')
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
    if (!/^\d{6}$/.test(code.trim())) return setError('El código tiene 6 dígitos.')
    void run(async () => {
      await api.confirmSignUp(email.trim().toLowerCase(), code.trim())
      setCode('')
      setTab('login')
      setInfo('Cuenta confirmada. Ya puedes iniciar sesión.')
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

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1 className="brand-title">
          <i className="pi pi-send" aria-hidden="true" /> TripPlanner AI
        </h1>
        <div className="tabs" role="tablist">
          {(
            [
              ['login', 'Iniciar sesión'],
              ['register', 'Crear cuenta'],
              ['confirm', 'Confirmar código'],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => go(t)}>
              {label}
            </button>
          ))}
        </div>

        {error && <Message severity="error" text={error} className="form-message" />}
        {info && <Message severity="success" text={info} className="form-message" />}

        <form
          onSubmit={tab === 'login' ? onLogin : tab === 'register' ? onRegister : onConfirm}
          className="form"
          noValidate
        >
          <label htmlFor="email">Correo electrónico</label>
          <InputText id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />

          {tab !== 'confirm' && (
            <>
              <label htmlFor="password">Contraseña</label>
              <Password
                inputId="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                feedback={false}
                toggleMask
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              />
              {tab === 'register' && <small className="muted">Mínimo 8 caracteres, con mayúscula, minúscula y número.</small>}
            </>
          )}

          {tab === 'confirm' && (
            <>
              <label htmlFor="code">Código de verificación</label>
              <InputText id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              <Button type="button" label="Reenviar código" text onClick={onResend} disabled={busy} className="link-button" />
            </>
          )}

          <Button
            type="submit"
            loading={busy}
            label={tab === 'login' ? 'Iniciar sesión' : tab === 'register' ? 'Crear cuenta' : 'Confirmar cuenta'}
          />
        </form>
      </div>
    </div>
  )
}

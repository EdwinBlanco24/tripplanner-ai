import { useState, type KeyboardEvent, type ReactNode } from 'react'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  invalid?: boolean
  describedBy?: string
  onCapsLock?: (on: boolean) => void
  children?: ReactNode
}

/** Campo con etiqueta flotante (CSS puro: placeholder vacio + :placeholder-shown) y, si es contrasena, boton de mostrar/ocultar. */
export function FloatingField({ id, label, value, onChange, type = 'text', autoComplete, invalid, describedBy, onCapsLock, children }: Props) {
  const [shown, setShown] = useState(false)
  const isPassword = type === 'password'
  const keys = (e: KeyboardEvent<HTMLInputElement>) => onCapsLock?.(e.getModifierState?.('CapsLock') ?? false)
  return (
    <div className={`float-field ${isPassword ? 'has-toggle' : ''}`}>
      <input
        id={id}
        className="float-input"
        type={isPassword && shown ? 'text' : type}
        value={value}
        placeholder=" "
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keys}
        onKeyUp={keys}
        onBlur={() => onCapsLock?.(false)}
      />
      <label htmlFor={id} className="float-label">
        {label}
      </label>
      {isPassword && (
        <button
          type="button"
          className="toggle-pass"
          aria-label={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          <i className={`pi ${shown ? 'pi-eye-slash' : 'pi-eye'}`} aria-hidden="true" />
        </button>
      )}
      {children}
    </div>
  )
}

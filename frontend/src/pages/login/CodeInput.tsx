import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

const LENGTH = 6

interface Props {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** Codigo de 6 digitos en casillas: avanza solo, retrocede con Backspace y acepta el codigo completo pegado. */
export function CodeInput({ value, onChange, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '')

  const focus = (i: number) => refs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus()
  const commit = (next: string[]) => onChange(next.join('').slice(0, LENGTH))

  const onInput = (i: number, raw: string) => {
    const only = raw.replace(/\D/g, '')
    const next = [...digits]
    if (!only) {
      next[i] = ''
      commit(next)
      return
    }
    // Varios digitos de golpe (autocompletado del sistema): se reparten desde esta casilla.
    only
      .slice(0, LENGTH - i)
      .split('')
      .forEach((d, k) => (next[i + k] = d))
    commit(next)
    focus(i + Math.min(only.length, LENGTH - i))
  }

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[i]) return // el onChange limpia esta casilla
      e.preventDefault()
      if (i > 0) {
        const next = [...digits]
        next[i - 1] = ''
        commit(next)
        focus(i - 1)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(i + 1)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH)
    if (!pasted) return
    e.preventDefault()
    onChange(pasted)
    focus(Math.min(pasted.length, LENGTH - 1))
  }

  return (
    <div className="code-boxes" role="group" aria-label="Código de verificación de 6 dígitos">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="code-box"
          value={d}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={LENGTH}
          aria-label={`Dígito ${i + 1} de ${LENGTH}`}
          disabled={disabled}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}

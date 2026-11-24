import { useEffect, useState } from 'react'

/** true si la persona pidio menos movimiento (prefers-reduced-motion: reduce). Se actualiza si cambia. */
export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

export const DESTINATIONS = ['Cartagena', 'Medellín', 'Madrid', 'Cusco', 'Ciudad de México', 'Buenos Aires']

/** Maquina de escribir que rota entre palabras. Con movimiento reducido devuelve la primera palabra, fija. */
export function useTypewriter(words: string[], reduced: boolean, speed = 85): string {
  const [text, setText] = useState(reduced ? words[0] : '')
  useEffect(() => {
    if (reduced) {
      setText(words[0])
      return
    }
    let word = 0
    let chars = 0
    let deleting = false
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const current = words[word]
      if (!deleting) {
        chars += 1
        setText(current.slice(0, chars))
        if (chars === current.length) {
          deleting = true
          timer = setTimeout(tick, 1600)
          return
        }
        timer = setTimeout(tick, speed)
      } else {
        chars -= 1
        setText(current.slice(0, chars))
        if (chars === 0) {
          deleting = false
          word = (word + 1) % words.length
          timer = setTimeout(tick, 350)
          return
        }
        timer = setTimeout(tick, speed / 2)
      }
    }
    timer = setTimeout(tick, 400)
    return () => clearTimeout(timer)
  }, [words, reduced, speed])
  return text
}

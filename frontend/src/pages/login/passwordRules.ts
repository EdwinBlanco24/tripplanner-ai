export interface PasswordCheck {
  id: 'length' | 'upper' | 'lower' | 'digit'
  label: string
  ok: boolean
}

/** Requisitos del UserPool (el backend manda; esto solo guia en vivo). */
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { id: 'length', label: 'Al menos 8 caracteres', ok: password.length >= 8 },
    { id: 'upper', label: 'Una mayúscula', ok: /[A-Z]/.test(password) },
    { id: 'lower', label: 'Una minúscula', ok: /[a-z]/.test(password) },
    { id: 'digit', label: 'Un número', ok: /\d/.test(password) },
  ]
}

export const isStrongEnough = (password: string): boolean => passwordChecks(password).every((c) => c.ok)

export type StrengthLevel = 'empty' | 'weak' | 'medium' | 'strong'

export interface Strength {
  /** 0 a 4: largo de la barra. */
  score: number
  level: StrengthLevel
  label: string
}

/** Debil: faltan requisitos. Media: cumple los 4. Fuerte: cumple los 4 y mide 12 o mas caracteres. */
export function passwordStrength(password: string): Strength {
  if (!password) return { score: 0, level: 'empty', label: '' }
  const met = passwordChecks(password).filter((c) => c.ok).length
  if (met < 4) return { score: met <= 2 ? 1 : 2, level: 'weak', label: 'Débil' }
  return password.length >= 12 ? { score: 4, level: 'strong', label: 'Fuerte' } : { score: 3, level: 'medium', label: 'Media' }
}

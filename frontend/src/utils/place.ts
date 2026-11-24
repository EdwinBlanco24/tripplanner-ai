import { normalizeText } from './text'

export interface Place {
  city: string
  country: string | null
}

/**
 * Separa "Ciudad, País" por la ÚLTIMA coma (la ciudad puede llevar comas: "Ciudad, Región, País").
 * Sin coma (valores antiguos como "Cartagena") el país es null.
 */
export function splitPlace(value: string): Place {
  const text = (value ?? '').trim()
  const i = text.lastIndexOf(',')
  if (i < 0) return { city: text, country: null }
  const city = text.slice(0, i).trim()
  const country = text.slice(i + 1).trim()
  if (!city) return { city: country, country: null }
  return { city, country: country || null }
}

/**
 * ¿Son el mismo lugar? Compara el valor completo normalizado; además, si la ciudad coincide y alguno
 * no tiene país, se considera el mismo (no se puede probar que sean distintos).
 */
export function samePlace(a: string, b: string): boolean {
  if (normalizeText(a) === normalizeText(b)) return true
  const pa = splitPlace(a)
  const pb = splitPlace(b)
  if (normalizeText(pa.city) !== normalizeText(pb.city)) return false
  return pa.country === null || pb.country === null
}

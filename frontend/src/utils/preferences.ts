export type TravelStyle = 'BEACH' | 'CULTURE' | 'GASTRONOMY' | 'ADVENTURE' | 'NIGHTLIFE' | 'NATURE'
export type Pace = 'RELAXED' | 'BALANCED' | 'INTENSE'
export type FlightTime = 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING'
export type BudgetLevel = 'ECONOMY' | 'STANDARD' | 'PREMIUM'

/** Preferencias del usuario (docs/03-api.md seccion 3.1). */
export interface Preferences {
  travelStyles: TravelStyle[]
  pace: Pace
  flightTime: FlightTime
  budgetLevel: BudgetLevel
  notes: string
}

export const MAX_NOTES = 200
export const MAX_STYLES = 6

export const STYLE_OPTIONS: { value: TravelStyle; label: string; icon: string }[] = [
  { value: 'BEACH', label: 'Playa', icon: 'pi-sun' },
  { value: 'CULTURE', label: 'Cultura', icon: 'pi-building-columns' },
  { value: 'GASTRONOMY', label: 'Gastronomía', icon: 'pi-star' },
  { value: 'ADVENTURE', label: 'Aventura', icon: 'pi-compass' },
  { value: 'NIGHTLIFE', label: 'Vida nocturna', icon: 'pi-moon' },
  { value: 'NATURE', label: 'Naturaleza', icon: 'pi-image' },
]
export const PACE_OPTIONS: { value: Pace; label: string }[] = [
  { value: 'RELAXED', label: 'Tranquilo' },
  { value: 'BALANCED', label: 'Equilibrado' },
  { value: 'INTENSE', label: 'Intenso' },
]
export const FLIGHT_TIME_OPTIONS: { value: FlightTime; label: string }[] = [
  { value: 'ANY', label: 'Cualquiera' },
  { value: 'MORNING', label: 'Mañana' },
  { value: 'AFTERNOON', label: 'Tarde' },
  { value: 'EVENING', label: 'Noche' },
]
export const BUDGET_OPTIONS: { value: BudgetLevel; label: string }[] = [
  { value: 'ECONOMY', label: 'Económico' },
  { value: 'STANDARD', label: 'Estándar' },
  { value: 'PREMIUM', label: 'Premium' },
]

/** Valores de "Restablecer": sin estilos, ritmo equilibrado, cualquier horario, presupuesto estandar, sin notas. */
export const DEFAULT_PREFERENCES: Preferences = { travelStyles: [], pace: 'BALANCED', flightTime: 'ANY', budgetLevel: 'STANDARD', notes: '' }

const isOneOf = <T extends string>(options: { value: T }[], v: unknown): v is T => typeof v === 'string' && options.some((o) => o.value === v)

/**
 * Lee las preferencias que devuelve la API o un componente ui. null si no hay (null, vacio o un item guardado con el
 * esquema anterior, que no trae ningun campo nuevo). Los valores desconocidos se ignoran.
 */
export function parsePreferences(raw: unknown): Preferences | null {
  const obj = raw && typeof raw === 'object' && 'preferences' in (raw as object) ? (raw as { preferences: unknown }).preferences : raw
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const styles = Array.isArray(o.travelStyles) ? o.travelStyles.filter((s): s is TravelStyle => isOneOf(STYLE_OPTIONS, s)) : []
  const hasAny = Array.isArray(o.travelStyles) || ['pace', 'flightTime', 'budgetLevel', 'notes'].some((k) => o[k] !== undefined && o[k] !== null)
  if (!hasAny) return null
  return {
    travelStyles: [...new Set(styles)],
    pace: isOneOf(PACE_OPTIONS, o.pace) ? o.pace : DEFAULT_PREFERENCES.pace,
    flightTime: isOneOf(FLIGHT_TIME_OPTIONS, o.flightTime) ? o.flightTime : DEFAULT_PREFERENCES.flightTime,
    budgetLevel: isOneOf(BUDGET_OPTIONS, o.budgetLevel) ? o.budgetLevel : DEFAULT_PREFERENCES.budgetLevel,
    notes: typeof o.notes === 'string' ? o.notes : '',
  }
}

/** Cuerpo del PUT: los cuatro campos siempre; notes solo si hay texto (un reemplazo completo). */
export function toRequestBody(p: Preferences): Record<string, unknown> {
  const body: Record<string, unknown> = { travelStyles: p.travelStyles, pace: p.pace, flightTime: p.flightTime, budgetLevel: p.budgetLevel }
  const notes = p.notes.trim()
  if (notes) body.notes = notes
  return body
}

const label = <T extends string>(options: { value: T; label: string }[], v: T) => options.find((o) => o.value === v)?.label ?? v

/** "Cultura · Gastronomía · Ritmo tranquilo" (solo lo que ya expresa una preferencia). */
export function summaryLine(p: Preferences): string {
  const parts: string[] = p.travelStyles.map((s) => label(STYLE_OPTIONS, s))
  parts.push(`Ritmo ${label(PACE_OPTIONS, p.pace).toLowerCase()}`)
  if (p.flightTime !== 'ANY') parts.push(`Vuelos de ${label(FLIGHT_TIME_OPTIONS, p.flightTime).toLowerCase()}`)
  if (p.budgetLevel !== 'STANDARD') parts.push(`Presupuesto ${label(BUDGET_OPTIONS, p.budgetLevel).toLowerCase()}`)
  return parts.join(' · ')
}

export function samePreferences(a: Preferences, b: Preferences): boolean {
  return a.pace === b.pace && a.flightTime === b.flightTime && a.budgetLevel === b.budgetLevel && a.notes.trim() === b.notes.trim() && a.travelStyles.length === b.travelStyles.length && a.travelStyles.every((s) => b.travelStyles.includes(s))
}

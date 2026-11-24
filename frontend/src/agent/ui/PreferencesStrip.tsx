import { Link } from 'react-router-dom'
import type { ConversationState } from '../reducer'
import { parsePreferences, summaryLine } from '../../utils/preferences'

/** Franja discreta del lienzo: que preferencias esta usando el asistente. Sin datos (null o vacio) no se muestra nada. */
export function PreferencesStrip({ state }: { state: ConversationState }) {
  const entry = state.uiLatest.preferences
  const prefs = entry ? parsePreferences(entry.data) : null
  if (!prefs) return null
  return (
    <div className="prefs-strip" role="status">
      <i className="pi pi-sliders-h" aria-hidden="true" />
      <span>Usando tus preferencias: {summaryLine(prefs)}</span>
      <Link to="/preferencias">Editar</Link>
    </div>
  )
}

import { useRef, useState } from 'react'
import { AutoComplete, type AutoCompleteChangeEvent, type AutoCompleteCompleteEvent } from 'primereact/autocomplete'
import { loadCityIndex, searchCities, type CitySuggestion } from '../utils/cities'

interface Props {
  inputId: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}

/**
 * Ciudad con sugerencias mundiales (GeoNames). Acepta texto libre tal cual; al elegir una sugerencia el valor guardado
 * es "Ciudad, País" (país en español). El archivo se descarga al primer foco; si falla, el campo sigue siendo un texto normal.
 */
export function CityAutocomplete({ inputId, value, onChange, invalid }: Props) {
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([])
  const latest = useRef(0)

  const complete = async (e: AutoCompleteCompleteEvent) => {
    const ticket = ++latest.current
    try {
      const index = await loadCityIndex()
      if (ticket === latest.current) setSuggestions(searchCities(index, e.query))
    } catch {
      if (ticket === latest.current) setSuggestions([])
    }
  }

  const change = (e: AutoCompleteChangeEvent) => {
    const v = e.value as string | CitySuggestion | null
    onChange(typeof v === 'string' ? v : (v?.value ?? ''))
  }

  return (
    <AutoComplete
      inputId={inputId}
      value={value}
      suggestions={suggestions}
      completeMethod={complete}
      onChange={change}
      onFocus={() => {
        loadCityIndex().catch(() => {})
      }}
      field="value"
      itemTemplate={(s: CitySuggestion) => <span>{s.label}</span>}
      minLength={2}
      delay={150}
      autoComplete="off"
      emptyMessage="Sin coincidencias: puedes escribir la ciudad."
      invalid={invalid}
      className="city-autocomplete"
      inputClassName="city-autocomplete-input"
    />
  )
}

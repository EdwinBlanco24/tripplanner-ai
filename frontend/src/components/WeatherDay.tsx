import type { DayWeather } from '../types'

export function WeatherDay({ weather }: { weather?: DayWeather }) {
  if (!weather) return <span className="muted weather">Sin pronóstico</span>
  const parts: string[] = []
  if (weather.tempMax !== undefined || weather.tempMin !== undefined) parts.push(`${weather.tempMax ?? '–'}° / ${weather.tempMin ?? '–'}°`)
  if (weather.rainProbability !== undefined) parts.push(`${weather.rainProbability}% lluvia`)
  return (
    <span className="weather">
      <i className="pi pi-cloud" aria-hidden="true" /> {weather.condition ?? 'Clima'}
      {parts.length > 0 && <span className="muted"> · {parts.join(' · ')}</span>}
    </span>
  )
}

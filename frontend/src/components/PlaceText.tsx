import { splitPlace } from '../utils/place'

/** Ciudad destacada y país en gris secundario. Un valor antiguo sin país muestra solo la ciudad. */
export function PlaceText({ value }: { value: string }) {
  const { city, country } = splitPlace(value)
  return (
    <span className="place">
      <span className="place-city">{city}</span>
      {country && <span className="place-country">, {country}</span>}
    </span>
  )
}

export function RouteText({ origin, destination }: { origin: string; destination: string }) {
  return (
    <span className="route">
      <PlaceText value={origin} /> → <PlaceText value={destination} />
    </span>
  )
}

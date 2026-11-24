import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlaceText, RouteText } from '../components/PlaceText'
import { samePlace, splitPlace } from '../utils/place'
import { validateTrip } from '../utils/validation'

describe('splitPlace', () => {
  it('con coma: ciudad y pais', () => expect(splitPlace('Cartagena, Colombia')).toEqual({ city: 'Cartagena', country: 'Colombia' }))
  it('sin coma (valor antiguo): solo ciudad', () => expect(splitPlace('Cartagena')).toEqual({ city: 'Cartagena', country: null }))
  it('separa por la ULTIMA coma (comas internas en la ciudad)', () => {
    expect(splitPlace('Cartagena, Región de Murcia, España')).toEqual({ city: 'Cartagena, Región de Murcia', country: 'España' })
  })
  it('recorta espacios y tolera comas colgantes', () => {
    expect(splitPlace('  San Cristóbal de La Laguna ,  España ')).toEqual({ city: 'San Cristóbal de La Laguna', country: 'España' })
    expect(splitPlace('Cartagena,')).toEqual({ city: 'Cartagena', country: null })
    expect(splitPlace('')).toEqual({ city: '', country: null })
  })
})

describe('samePlace y validacion origen/destino', () => {
  it('valor completo normalizado', () => expect(samePlace('Bogotá, Colombia', 'BOGOTA, colombia')).toBe(true))
  it('misma ciudad en paises distintos no es el mismo lugar', () => expect(samePlace('Cartagena, Colombia', 'Cartagena, España')).toBe(false))
  it('misma ciudad y alguno sin pais: se considera igual', () => {
    expect(samePlace('Cartagena', 'Cartagena, Colombia')).toBe(true)
    expect(samePlace('cartagena, España', 'Cartagena')).toBe(true)
  })
  it('ciudades distintas', () => expect(samePlace('Bogotá, Colombia', 'Medellín, Colombia')).toBe(false))

  const ok = { title: 'V', origin: 'Bogotá, Colombia', destination: 'Cartagena, Colombia', startDate: '2027-12-04', endDate: '2027-12-07', travelers: 1, budget: 1000, currency: 'COP' as const }
  it('validateTrip rechaza origen = destino y acepta homonimas de paises distintos', () => {
    expect(validateTrip({ ...ok, destination: 'bogota, COLOMBIA' }, '2027-12-01').destination).toBe('El destino debe ser distinto del origen.')
    expect(validateTrip({ ...ok, origin: 'Cartagena', destination: 'Cartagena, Colombia' }, '2027-12-01').destination).toBeTruthy()
    expect(validateTrip({ ...ok, origin: 'Cartagena, España', destination: 'Cartagena, Colombia' }, '2027-12-01')).toEqual({})
  })
})

describe('visualizacion', () => {
  it('ciudad destacada y pais en gris', () => {
    render(<PlaceText value="Cartagena, Colombia" />)
    expect(screen.getByText('Cartagena')).toHaveClass('place-city')
    expect(screen.getByText(', Colombia')).toHaveClass('place-country')
  })
  it('valor antiguo sin pais: solo la ciudad', () => {
    const { container } = render(<PlaceText value="Cartagena" />)
    expect(screen.getByText('Cartagena')).toHaveClass('place-city')
    expect(container.querySelector('.place-country')).toBeNull()
  })
  it('la ruta muestra origen y destino', () => {
    const { container } = render(<RouteText origin="Bogotá, Colombia" destination="Cartagena" />)
    expect(container.textContent).toBe('Bogotá, Colombia → Cartagena')
    expect(container.querySelectorAll('.place-country')).toHaveLength(1)
  })
})

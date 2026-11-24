import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, type Services } from '../app/AppContext'
import { TripFormDialog } from '../components/TripFormDialog'
import { resetCityCache } from '../utils/cities'

const data = readFileSync('public/data/cities.json', 'utf8')

function setup() {
  const createTrip = vi.fn().mockResolvedValue({ tripId: 'TRP-1' })
  const onHide = vi.fn()
  const services = {
    auth: { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => () => {}, email: 'a@b.co', restore: async () => true },
    resources: { createTrip },
  } as unknown as Services
  render(
    <AppProvider services={services}>
      <TripFormDialog visible onHide={onHide} onSaved={() => {}} />
    </AppProvider>,
  )
  return { createTrip, onHide }
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement
async function type(id: string, text: string) {
  input(id).focus()
  fireEvent.change(input(id), { target: { value: text } })
  await waitFor(() => expect(document.querySelector('.p-autocomplete-panel')).toBeTruthy())
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  resetCityCache()
  fetchMock = vi.fn().mockImplementation(async () => new Response(data, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('TripFormDialog con ciudades', () => {
  it('no descarga las ciudades hasta el primer foco, y solo una vez', async () => {
    setup()
    expect(fetchMock).not.toHaveBeenCalled()
    input('trip-origin').focus()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    input('trip-destination').focus()
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('muestra "Ciudad · Region, Pais" y al elegir guarda "Ciudad, País"', async () => {
    const { createTrip } = setup()
    await type('trip-origin', 'bogota')
    fireEvent.click(await screen.findByText('Bogotá · Bogota D.C., Colombia'))
    await waitFor(() => expect(input('trip-origin').value).toBe('Bogotá, Colombia'))

    await type('trip-destination', 'cartagena')
    fireEvent.click(await screen.findByText('Cartagena · Bolívar, Colombia'))
    await waitFor(() => expect(input('trip-destination').value).toBe('Cartagena, Colombia'))

    fireEvent.change(input('trip-title'), { target: { value: 'Viaje' } })
    fireEvent.change(input('trip-start'), { target: { value: '2999-12-04' } })
    fireEvent.change(input('trip-end'), { target: { value: '2999-12-07' } })
    await userEvent.type(input('trip-budget'), '1000000')
    await userEvent.tab()
    fireEvent.click(screen.getByRole('button', { name: 'Crear viaje' }))
    await waitFor(() => expect(createTrip).toHaveBeenCalledTimes(1))
    expect(createTrip.mock.calls[0][0]).toMatchObject({ origin: 'Bogotá, Colombia', destination: 'Cartagena, Colombia' })
  })

  it('acepta texto libre (sin elegir sugerencia)', () => {
    setup()
    fireEvent.change(input('trip-origin'), { target: { value: 'Mi pueblito' } })
    expect(input('trip-origin').value).toBe('Mi pueblito')
  })

  it('rechaza origen igual a destino con mensaje en espanol y no envia', async () => {
    const { createTrip } = setup()
    fireEvent.change(input('trip-title'), { target: { value: 'Viaje' } })
    fireEvent.change(input('trip-origin'), { target: { value: 'Bogotá' } })
    fireEvent.change(input('trip-destination'), { target: { value: 'bogota' } })
    fireEvent.change(input('trip-start'), { target: { value: '2999-12-04' } })
    fireEvent.change(input('trip-end'), { target: { value: '2999-12-07' } })
    fireEvent.change(input('trip-budget'), { target: { value: '1000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear viaje' }))
    expect(await screen.findByText('El destino debe ser distinto del origen.')).toBeInTheDocument()
    expect(createTrip).not.toHaveBeenCalled()
  })

  it('si cities.json no se puede descargar el campo sigue siendo texto libre', async () => {
    fetchMock.mockImplementation(async () => new Response('x', { status: 500 }))
    setup()
    input('trip-origin').focus()
    fireEvent.change(input('trip-origin'), { target: { value: 'Quito' } })
    await new Promise((r) => setTimeout(r, 400))
    expect(input('trip-origin').value).toBe('Quito')
    expect(screen.getByText('Nuevo viaje')).toBeInTheDocument()
  })

  it('Esc con la lista abierta cierra la lista y NO el dialogo; el siguiente Esc cierra el dialogo', async () => {
    const { onHide } = setup()
    await type('trip-origin', 'bogota')
    fireEvent.keyDown(input('trip-origin'), { key: 'Escape', keyCode: 27, which: 27 })
    await waitFor(() => expect(document.querySelector('.p-autocomplete-panel')).toBeNull())
    expect(onHide).not.toHaveBeenCalled()
    expect(screen.getByText('Nuevo viaje')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('muestra la atribucion de GeoNames', () => {
    setup()
    expect(screen.getByText(/GeoNames \(CC BY 4\.0\)/)).toBeInTheDocument()
  })
})

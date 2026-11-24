import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppProvider, type Services } from '../app/AppContext'
import { Assistant } from '../pages/Assistant'
import { createSimulatedStream } from '../dev/simulatedStream'
import { SUGGESTIONS } from '../agent/ui/ChatPanel'

function setup() {
  const services = {
    auth: { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => () => {}, email: 'a@b.co', restore: async () => true },
    resources: {},
    stream: createSimulatedStream(0),
  } as unknown as Services
  render(
    <MemoryRouter>
      <AppProvider services={services}>
        <Assistant />
      </AppProvider>
    </MemoryRouter>,
  )
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })

describe('pantalla Asistente', () => {
  it('sin datos: pestañas de resultados desactivadas y sugerencias iniciales', () => {
    setup()
    for (const t of ['Vuelos', 'Clima', 'Viaje', 'Itinerario', 'Reservas']) expect(tab(t)).toBeDisabled()
    for (const s of SUGGESTIONS) expect(screen.getByRole('button', { name: s })).toBeInTheDocument()
  })

  it('un mensaje recorre status → ui → texto → ui → done y llena el lienzo', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: SUGGESTIONS[1] }))
    await waitFor(() => expect(screen.getByText('Wingo P57216')).toBeInTheDocument(), { timeout: 3000 })
    // Markdown con tabla en el chat
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Aerolínea' })).toBeInTheDocument())
    // el clima llego despues: la pestaña se activa sola y las demas siguen desactivadas
    await waitFor(() => expect(tab('Clima')).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByText(/Cartagena de Indias/)).toBeInTheDocument()
    expect(screen.getByText('viernes')).toBeInTheDocument() // weekday de los datos
    expect(tab('Vuelos')).toBeEnabled()
    expect(tab('Viaje')).toBeDisabled()
    // todos los status terminan en ✓ y vuelve el boton Enviar
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument())
    expect(screen.queryAllByLabelText('En curso')).toHaveLength(0)
    expect(screen.getAllByLabelText('Listo').length).toBeGreaterThanOrEqual(2)
  })

  it('Reservar manda un mensaje visible en el chat (sin viaje conocido pide aclarar)', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: SUGGESTIONS[2] }))
    await waitFor(() => expect(screen.getByText('Wingo P57216')).toBeInTheDocument(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument())
    fireEvent.click(tab('Vuelos'))
    const card = screen.getByText('Wingo P57216').closest('article') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Reservar' }))
    await waitFor(() =>
      expect(
        screen.getByText(/Registra una reserva SIMULADA del vuelo Wingo P57216 del 2026-12-04 \(BOG→CTG, salida 06:35, llegada 08:07\) por 398 USD en el viaje que corresponda; si hay varios, pregúntame cuál/),
      ).toBeInTheDocument(),
    )
  })

  it('Enter envia y Shift+Enter agrega una linea', async () => {
    setup()
    const box = screen.getByLabelText('Mensaje para el asistente') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hola' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(screen.queryByText('hola', { selector: '.bubble-user' })).toBeNull()
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('hola', { selector: '.bubble-user' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument(), { timeout: 3000 })
  })

  it('Nueva conversacion limpia chat y resultados', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: SUGGESTIONS[0] }))
    await waitFor(() => expect(screen.getByText('Wingo P57216')).toBeInTheDocument(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Nueva conversación/ }))
    expect(screen.queryByText('Wingo P57216')).toBeNull()
    expect(tab('Vuelos')).toBeDisabled()
  })
})

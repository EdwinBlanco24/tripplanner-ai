import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppProvider, type Services } from '../app/AppContext'
import { ReservationFormDialog } from '../components/ReservationFormDialog'
import type { Trip } from '../types'

const TRIP: Trip = {
  tripId: 'TRP-1', title: 'Cartagena', origin: 'Bogotá', destination: 'Cartagena', startDate: '2027-12-04', endDate: '2027-12-07',
  travelers: 2, budget: 1000, currency: 'COP', createdBy: 'user', status: 'PLANNED', createdAt: '', updatedAt: '',
}

function setup(props: { trip?: Trip; trips?: Trip[] }) {
  const createReservation = vi.fn().mockResolvedValue({})
  const services = {
    auth: { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => () => {}, email: 'a@b.co', restore: async () => true },
    resources: { createReservation },
  } as unknown as Services
  render(
    <AppProvider services={services}>
      <ReservationFormDialog visible onHide={() => {}} onSaved={() => {}} {...props} />
    </AppProvider>,
  )
  return { createReservation }
}

const field = (inputId: string) => document.getElementById(inputId)!.closest('.p-dropdown') as HTMLElement
async function choose(inputId: string, label: string) {
  fireEvent.click(field(inputId))
  const panel = await waitFor(() => {
    const p = document.querySelector('.p-dropdown-panel') as HTMLElement
    expect(p).toBeTruthy()
    return p
  })
  fireEvent.click(within(panel).getByText(label))
}

describe('ReservationFormDialog: selector de tipo', () => {
  // Regresion S4.1: con un viaje fijo (sin `trips`) el valor por defecto `[]` era un arreglo nuevo en cada
  // render y el efecto de reinicio devolvia el formulario a "Vuelo" justo despues de elegir.
  it('al elegir Hotel con un viaje fijo el tipo se conserva y aparecen los campos de hotel', async () => {
    setup({ trip: TRIP })
    await choose('res-type', 'Hotel')
    await waitFor(() => expect(screen.getByLabelText('Hotel')).toBeInTheDocument())
    expect((document.getElementById('res-type') as HTMLInputElement).value).toBe('Hotel')
  })

  it('crea una reserva HOTEL con el cuerpo esperado', async () => {
    const { createReservation } = setup({ trip: TRIP })
    await choose('res-type', 'Hotel')
    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Casa Luna' } })
    fireEvent.change(await screen.findByLabelText('Hotel'), { target: { value: 'Hotel Luna' } })
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2027-12-04' } })
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2027-12-06' } })
    fireEvent.change(screen.getByLabelText('Precio'), { target: { value: '500000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir reserva' }))
    await waitFor(() => expect(createReservation).toHaveBeenCalledTimes(1))
    const [tripId, body] = createReservation.mock.calls[0]
    expect(tripId).toBe('TRP-1')
    expect(body).toMatchObject({ type: 'HOTEL', provider: 'Casa Luna', details: { hotelName: 'Hotel Luna', checkIn: '2027-12-04', checkOut: '2027-12-06' } })
  })

  it('crea una reserva ACTIVITY con el cuerpo esperado (viaje elegido de la lista)', async () => {
    const { createReservation } = setup({ trips: [TRIP] })
    await choose('res-type', 'Actividad')
    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Tours SA' } })
    fireEvent.change(await screen.findByLabelText('Actividad'), { target: { value: 'Ciudad amurallada' } })
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2027-12-05' } })
    fireEvent.change(screen.getByLabelText('Precio'), { target: { value: '80000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir reserva' }))
    await waitFor(() => expect(createReservation).toHaveBeenCalledTimes(1))
    expect(createReservation.mock.calls[0][1]).toMatchObject({ type: 'ACTIVITY', details: { activityName: 'Ciudad amurallada', date: '2027-12-05' } })
  })
})

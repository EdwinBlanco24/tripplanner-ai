import { useEffect, useMemo, useState } from 'react'
import { Button } from 'primereact/button'
import { AppProvider, useApp, type Services } from '../app/AppContext'
import { TripFormDialog } from '../components/TripFormDialog'
import { ReservationFormDialog } from '../components/ReservationFormDialog'
import { Assistant } from '../pages/Assistant'
import { createSimulatedStream } from './simulatedStream'
import type { Trip } from '../types'

/** Solo desarrollo (ruta /dev/sandbox): formularios con servicios simulados, sin sesion ni API. */
const TRIPS: Trip[] = [
  { tripId: 'TRP-1', title: 'Cartagena en diciembre', origin: 'Bogotá', destination: 'Cartagena', startDate: '2027-12-04', endDate: '2027-12-07', travelers: 2, budget: 3500000, currency: 'COP', createdBy: 'user', status: 'PLANNED', createdAt: '', updatedAt: '' },
]

export function Sandbox() {
  const [open, setOpen] = useState<'trip' | 'res' | 'res-trip' | null>(null)
  const services = useMemo(() => {
    const noop = () => {}
    const auth = { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => noop, email: 'dev@example.com', restore: async () => true }
    const resources = {
      createTrip: async (b: unknown) => ({ ...TRIPS[0], ...(b as object) }),
      updateTrip: async () => TRIPS[0],
      createReservation: async () => ({}),
    }
    return { auth, resources } as unknown as Services
  }, [])
  return (
    <AppProvider services={services}>
      <div className="page">
        <h1>Sandbox de formularios (solo desarrollo)</h1>
        <div className="head-actions">
          <Button label="Nuevo viaje" onClick={() => setOpen('trip')} />
          <Button label="+ Añadir reserva" onClick={() => setOpen('res')} />
          <Button label="+ Añadir reserva (desde un viaje)" onClick={() => setOpen('res-trip')} />
        </div>
        <TripFormDialog visible={open === 'trip'} onHide={() => setOpen(null)} onSaved={() => setOpen(null)} />
        <ReservationFormDialog visible={open === 'res'} trips={TRIPS} onHide={() => setOpen(null)} onSaved={() => setOpen(null)} />
        <ReservationFormDialog visible={open === 'res-trip'} trip={TRIPS[0]} onHide={() => setOpen(null)} onSaved={() => setOpen(null)} />
      </div>
    </AppProvider>
  )
}

/** Solo desarrollo (/dev/assistant): el Asistente con un stream simulado desde los fixtures. ?auto=1 envia un mensaje al abrir. */
export function SandboxAssistant() {
  const services = useMemo(() => {
    const noop = () => {}
    const auth = { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => noop, email: 'dev@example.com', restore: async () => true }
    return { auth, resources: {}, stream: createSimulatedStream(150, (new URLSearchParams(location.search).get('mode') as 'tabla' | 'breve' | null) ?? 'normal') } as unknown as Services
  }, [])
  return (
    <AppProvider services={services}>
      <main className="page">
        <AssistantAuto />
      </main>
    </AppProvider>
  )
}

function AssistantAuto() {
  const { assistant } = useApp()
  useEffect(() => {
    if (new URLSearchParams(location.search).has('auto')) void assistant.send('Busca vuelos de Bogotá a Cartagena el 4 de diciembre de 2026 por la mañana para 3 personas')
  }, [assistant])
  return <Assistant />
}

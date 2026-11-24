import { useEffect, useMemo, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Button } from 'primereact/button'
import { AppProvider, useApp, type Services } from '../app/AppContext'
import { TripFormDialog } from '../components/TripFormDialog'
import { ReservationFormDialog } from '../components/ReservationFormDialog'
import { Assistant } from '../pages/Assistant'
import { Flights } from '../pages/Flights'
import { TripDetail } from '../pages/TripDetail'
import { Preferences } from '../pages/Preferences'
import { setConfig } from '../config/config'
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

/** Solo desarrollo (/dev/flights): la pagina Vuelos con el stream simulado en modo "breve" (respuesta que termina en pregunta). */
export function SandboxFlights() {
  const services = useMemo(() => {
    const noop = () => {}
    const auth = { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => noop, email: 'dev@example.com', restore: async () => true }
    return { auth, resources: {}, stream: createSimulatedStream(150, 'breve') } as unknown as Services
  }, [])
  return (
    <AppProvider services={services}>
      <main className="page">
        <Flights />
      </main>
    </AppProvider>
  )
}

/** Solo desarrollo (/dev/trip/TRP-demo): detalle de viaje con datos de ejemplo (reservas en USD y COP) y la tasa de referencia. */
export function SandboxTrip() {
  const services = useMemo(() => {
    const noop = () => {}
    setConfig({ apiUrl: 'https://dev.example.com', region: 'us-east-2', userPoolId: 'x', userPoolClientId: 'x', orchestratorRuntimeArn: 'x', exchangeRates: { base: 'COP', USD: 3300, asOf: '2026-11-24', label: 'Tasa de referencia aproximada (TRM nov. 2026)' } })
    const trip: Trip = { ...TRIPS[0], tripId: 'TRP-4f1c9a2e', title: 'Vacaciones en Cartagena', origin: 'Bogotá, Colombia', destination: 'Cartagena, Colombia', startDate: '2026-12-03', endDate: '2026-12-06', travelers: 3, budget: 5000000, createdBy: 'assistant' }
    const base = { tripId: trip.tripId, status: 'SIMULADA' as const, createdBy: 'assistant' as const, createdAt: '', updatedAt: '' }
    const reservations = [
      { ...base, resId: 'RES-a1b2c3d4', type: 'FLIGHT' as const, provider: 'Wingo', details: { airline: 'Wingo', flightNumber: 'P57216', departureTime: '2026-12-03T06:35', arrivalTime: '2026-12-03T08:10', origin: 'BOG', destination: 'CTG' }, price: 398, currency: 'USD' as const },
      { ...base, resId: 'RES-e5f6a7b8', type: 'HOTEL' as const, provider: 'Hotel Caribe', details: { hotelName: 'Hotel Caribe', checkIn: '2026-12-03', checkOut: '2026-12-06' }, price: 1200000, currency: 'COP' as const },
      { ...base, resId: 'RES-c9d0e1f2', type: 'ACTIVITY' as const, provider: 'Islas del Rosario', details: { activityName: 'Islas del Rosario', date: '2026-12-05' }, price: 250000, currency: 'COP' as const },
    ]
    const auth = { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => noop, email: 'dev@example.com', restore: async () => true }
    return { auth, resources: { getTrip: async () => ({ trip, itinerary: null, reservations }) } } as unknown as Services
  }, [])
  return (
    <AppProvider services={services}>
      <main className="page">
        <Routes>
          <Route path=":tripId" element={<TripDetail />} />
        </Routes>
      </main>
    </AppProvider>
  )
}

/** Solo desarrollo (/dev/preferences): Mis preferencias con datos de ejemplo (el guardado se simula). */
export function SandboxPreferences() {
  const services = useMemo(() => {
    const noop = () => {}
    const auth = { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => noop, email: 'dev@example.com', restore: async () => true }
    const saved = { travelStyles: ['CULTURE', 'GASTRONOMY', 'NATURE'], pace: 'RELAXED', flightTime: 'MORNING', budgetLevel: 'STANDARD', notes: 'Prefiero hoteles tranquilos y vuelos sin escalas.' }
    return { auth, resources: { getPreferences: async () => saved, savePreferences: async () => saved } } as unknown as Services
  }, [])
  return (
    <AppProvider services={services}>
      <main className="page">
        <Preferences />
      </main>
    </AppProvider>
  )
}

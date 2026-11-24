import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Shell } from './components/Shell'

import { RouteFallback } from './components/RouteFallback'

// Rutas pesadas: cargadas bajo demanda (chunk aparte) para aligerar el arranque.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })))
const Reservations = lazy(() => import('./pages/Reservations').then((m) => ({ default: m.Reservations })))
const TripDetail = lazy(() => import('./pages/TripDetail').then((m) => ({ default: m.TripDetail })))
const Trips = lazy(() => import('./pages/Trips').then((m) => ({ default: m.Trips })))
const Preferences = lazy(() => import('./pages/Preferences').then((m) => ({ default: m.Preferences })))
const Assistant = lazy(() => import('./pages/Assistant').then((m) => ({ default: m.Assistant })))
const Flights = lazy(() => import('./pages/Flights').then((m) => ({ default: m.Flights })))
const Weather = lazy(() => import('./pages/Weather').then((m) => ({ default: m.Weather })))
const Voucher = lazy(() => import('./pages/Voucher').then((m) => ({ default: m.Voucher })))
const lazyPage = (el: React.ReactNode) => <Suspense fallback={<RouteFallback />}>{el}</Suspense>

// Solo en desarrollo: import.meta.env.DEV es false en el build y el chunk no se genera.
const Sandbox = import.meta.env.DEV ? lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.Sandbox }))) : null
const SandboxAssistant = import.meta.env.DEV ? lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.SandboxAssistant }))) : null
const SandboxFlights = import.meta.env.DEV ? lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.SandboxFlights }))) : null
const SandboxTrip = import.meta.env.DEV ? lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.SandboxTrip }))) : null
const SandboxPreferences = import.meta.env.DEV ? lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.SandboxPreferences }))) : null

export function App() {
  return (
    <Routes>
      <Route path="/login" element={lazyPage(<Login />)} />
      {SandboxAssistant && (
        <Route path="/dev/assistant" element={<Suspense fallback={null}><SandboxAssistant /></Suspense>} />
      )}
      {SandboxPreferences && (
        <Route path="/dev/preferences" element={<Suspense fallback={null}><SandboxPreferences /></Suspense>} />
      )}
      {SandboxTrip && (
        <Route path="/dev/trip/*" element={<Suspense fallback={null}><SandboxTrip /></Suspense>} />
      )}
      {SandboxFlights && (
        <Route path="/dev/flights" element={<Suspense fallback={null}><SandboxFlights /></Suspense>} />
      )}
      {Sandbox && (
        <Route path="/dev/sandbox" element={<Suspense fallback={null}><Sandbox /></Suspense>} />
      )}
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={lazyPage(<Dashboard />)} />
          <Route path="asistente" element={lazyPage(<Assistant />)} />
          <Route path="preferencias" element={lazyPage(<Preferences />)} />
          <Route path="vuelos" element={lazyPage(<Flights />)} />
          <Route path="clima" element={lazyPage(<Weather />)} />
          <Route path="viajes" element={lazyPage(<Trips />)} />
          <Route path="viajes/:tripId" element={lazyPage(<TripDetail />)} />
          <Route path="reservas" element={lazyPage(<Reservations />)} />
          <Route path="reservas/:tripId/:resId/comprobante" element={lazyPage(<Voucher />)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

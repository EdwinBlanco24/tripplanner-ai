import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Shell } from './components/Shell'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Assistant } from './pages/Assistant'
import { Flights } from './pages/Flights'
import { Weather } from './pages/Weather'
import { Reservations } from './pages/Reservations'
import { TripDetail } from './pages/TripDetail'
import { Trips } from './pages/Trips'
import { Voucher } from './pages/Voucher'

// Solo en desarrollo: import.meta.env.DEV es false en el build y el chunk no se genera.
const Sandbox = import.meta.env.DEV ? lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.Sandbox }))) : null
const SandboxAssistant = import.meta.env.DEV ? lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.SandboxAssistant }))) : null

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {SandboxAssistant && (
        <Route path="/dev/assistant" element={<Suspense fallback={null}><SandboxAssistant /></Suspense>} />
      )}
      {Sandbox && (
        <Route path="/dev/sandbox" element={<Suspense fallback={null}><Sandbox /></Suspense>} />
      )}
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="asistente" element={<Assistant />} />
          <Route path="vuelos" element={<Flights />} />
          <Route path="clima" element={<Weather />} />
          <Route path="viajes" element={<Trips />} />
          <Route path="viajes/:tripId" element={<TripDetail />} />
          <Route path="reservas" element={<Reservations />} />
          <Route path="reservas/:tripId/:resId/comprobante" element={<Voucher />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../app/AppContext'

export function ProtectedRoute() {
  const { signedIn, restoring } = useApp()
  const location = useLocation()
  if (restoring) return <div className="splash" role="status">Cargando…</div>
  if (!signedIn) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from 'primereact/button'
import { useApp } from '../app/AppContext'

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/asistente', label: 'Asistente' },
  { to: '/vuelos', label: 'Vuelos' },
  { to: '/clima', label: 'Clima' },
  { to: '/viajes', label: 'Mis viajes' },
  { to: '/reservas', label: 'Reservas' },
]

export function Shell() {
  const { email, auth } = useApp()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)

  const logout = () => {
    auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <header className="shell-header no-print">
        <div className="shell-bar">
          <Button
            className="nav-toggle"
            icon="pi pi-bars"
            text
            rounded
            aria-label="Abrir menú"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          />
          <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
            <i className="pi pi-send" aria-hidden="true" /> TripPlanner AI
          </NavLink>
          <nav className={`main-nav ${open ? 'open' : ''}`} aria-label="Principal">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="user-menu">
            <Button
              icon="pi pi-user"
              label={email ?? 'Cuenta'}
              className="user-button"
              text
              onClick={() => setMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menu}
            />
            {menu && (
              <div className="user-popup" role="menu">
                <div className="muted user-email">{email}</div>
                <Button label="Cerrar sesión" icon="pi pi-sign-out" text severity="danger" onClick={logout} role="menuitem" />
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}

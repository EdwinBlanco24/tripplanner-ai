import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const logout = () => {
    auth.signOut()
    navigate('/login', { replace: true })
  }

  const closeMenu = (returnFocus: boolean) => {
    setMenu(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  // Al abrir, el foco va al primer elemento del menu; un clic fuera lo cierra.
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const onMenuKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && menu) {
      ev.stopPropagation()
      closeMenu(true)
    }
  }

  const goPrefs = () => {
    setMenu(false)
    setOpen(false)
    navigate('/preferencias')
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
            <div className="nav-extra">
              <NavLink to="/preferencias" onClick={() => setOpen(false)}>
                <i className="pi pi-sliders-h" aria-hidden="true" /> Mis preferencias
              </NavLink>
              <button
                type="button"
                className="nav-logout"
                onClick={() => {
                  setOpen(false)
                  logout()
                }}
              >
                <i className="pi pi-sign-out" aria-hidden="true" /> Cerrar sesión
              </button>
            </div>
          </nav>
          <div className="user-menu" onKeyDown={onMenuKey}>
            <Button
              icon="pi pi-cog"
              rounded
              text
              className="prefs-button"
              aria-label="Mis preferencias"
              tooltip="Mis preferencias"
              tooltipOptions={{ position: 'bottom' }}
              onClick={goPrefs}
            />
            <button
              ref={triggerRef}
              type="button"
              className="p-button p-button-text user-button"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-controls="user-popup"
              onClick={() => setMenu((v) => !v)}
            >
              <i className="pi pi-user" aria-hidden="true" />
              <span className="p-button-label">{email ?? 'Cuenta'}</span>
              <i className="pi pi-chevron-down user-caret" aria-hidden="true" />
            </button>
            {menu && (
              <div className="user-popup" role="menu" id="user-popup" ref={menuRef} aria-label="Menú de usuario">
                <div className="muted user-email">{email}</div>
                <Button label="Mis preferencias" icon="pi pi-sliders-h" text role="menuitem" onClick={goPrefs} />
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

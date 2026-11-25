import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppProvider, type Services } from '../app/AppContext'
import { Shell } from '../components/Shell'
import { Dashboard } from '../pages/Dashboard'

const SAVED = { travelStyles: ['CULTURE'], pace: 'BALANCED', flightTime: 'ANY', budgetLevel: 'STANDARD', updatedAt: 'x' }

function services(prefs: unknown) {
  const signOut = vi.fn()
  const resources = {
    getPreferences: vi.fn(async () => prefs),
    listTrips: async () => [],
    listReservations: async () => [],
    getTrip: async () => null,
  }
  const svc = { auth: { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => () => {}, email: 'ana@correo.co', restore: async () => true, signOut }, resources } as unknown as Services
  return { svc, signOut }
}

function mountShell(svc: Services) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppProvider services={svc}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<div>inicio</div>} />
            <Route path="/preferencias" element={<div>pantalla de preferencias</div>} />
            <Route path="/login" element={<div>login</div>} />
          </Route>
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  )
}

describe('menu del usuario', () => {
  it('el boton del usuario muestra el correo y anuncia el menu (aria-haspopup / aria-expanded)', () => {
    mountShell(services(null).svc)
    const btn = screen.getByRole('button', { name: /ana@correo\.co/ })
    expect(btn.getAttribute('aria-haspopup')).toBe('menu')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.querySelector('.pi-chevron-down')).not.toBeNull()
  })

  it('abre el menu, enfoca la primera opcion y navega a /preferencias', async () => {
    mountShell(services(null).svc)
    const btn = screen.getByRole('button', { name: /ana@correo\.co/ })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Mis preferencias', 'Cerrar sesión'])
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    fireEvent.click(items[0])
    expect(screen.getByText('pantalla de preferencias')).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Esc cierra el menu y devuelve el foco al boton', async () => {
    mountShell(services(null).svc)
    const btn = screen.getByRole('button', { name: /ana@correo\.co/ })
    fireEvent.click(btn)
    const item = screen.getAllByRole('menuitem')[0]
    await waitFor(() => expect(document.activeElement).toBe(item))
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('un clic fuera cierra el menu', () => {
    mountShell(services(null).svc)
    fireEvent.click(screen.getByRole('button', { name: /ana@correo\.co/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Cerrar sesion sale y lleva al login', () => {
    const { svc, signOut } = services(null)
    mountShell(svc)
    fireEvent.click(screen.getByRole('button', { name: /ana@correo\.co/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Cerrar sesión/ }))
    expect(signOut).toHaveBeenCalled()
    expect(screen.getByText('login')).toBeTruthy()
  })

  it('el engranaje visible navega a /preferencias', () => {
    mountShell(services(null).svc)
    const gear = screen.getByRole('button', { name: 'Mis preferencias' })
    expect(gear.querySelector('.pi-cog')).not.toBeNull()
    fireEvent.click(gear)
    expect(screen.getByText('pantalla de preferencias')).toBeTruthy()
  })

  it('el menu movil (hamburguesa) incluye Mis preferencias y Cerrar sesion', () => {
    const { svc, signOut } = services(null)
    mountShell(svc)
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    expect(nav.className).toContain('open')
    const prefs = nav.querySelector('a[href="/preferencias"]') as HTMLElement
    expect(prefs.textContent).toContain('Mis preferencias')
    fireEvent.click(prefs)
    expect(screen.getByText('pantalla de preferencias')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    fireEvent.click(nav.querySelector('.nav-logout') as HTMLElement)
    expect(signOut).toHaveBeenCalled()
  })
})

describe('Dashboard: enlace para editar preferencias', () => {
  const mountDash = (svc: Services) =>
    render(
      <MemoryRouter>
        <AppProvider services={svc}>
          <Dashboard />
        </AppProvider>
      </MemoryRouter>,
    )

  it('con preferencias guardadas muestra el enlace y no la tarjeta Personaliza', async () => {
    mountDash(services(SAVED).svc)
    const link = await screen.findByRole('link', { name: /Editar mis preferencias/ })
    expect(link.getAttribute('href')).toBe('/preferencias')
    expect(screen.queryByText('Personaliza tus recomendaciones')).toBeNull()
  })

  it('sin preferencias sale la tarjeta y no el enlace', async () => {
    mountDash(services(null).svc)
    expect(await screen.findByText('Personaliza tus recomendaciones')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Editar mis preferencias/ })).toBeNull()
  })

  it('si la lectura falla no se muestra ninguno de los dos', async () => {
    const { svc } = services(null)
    ;(svc.resources as unknown as { getPreferences: () => Promise<never> }).getPreferences = async () => {
      throw new Error('boom')
    }
    mountDash(svc)
    await screen.findByText(/Hola/)
    expect(screen.queryByText('Personaliza tus recomendaciones')).toBeNull()
    expect(screen.queryByRole('link', { name: /Editar mis preferencias/ })).toBeNull()
  })
})

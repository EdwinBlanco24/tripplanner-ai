import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppProvider, type Services } from '../app/AppContext'
import { PreferencesStrip } from '../agent/ui/PreferencesStrip'
import { SUGGESTIONS } from '../agent/ui/ChatPanel'
import { initialConversation, reduce, type ConversationState } from '../agent/reducer'
import { Canvas } from '../agent/ui/Canvas'
import { Dashboard } from '../pages/Dashboard'
import { Preferences } from '../pages/Preferences'
import { DEFAULT_PREFERENCES, parsePreferences, samePreferences, summaryLine, toRequestBody } from '../utils/preferences'

const SAVED = { travelStyles: ['CULTURE', 'GASTRONOMY'], pace: 'RELAXED', flightTime: 'ANY', budgetLevel: 'STANDARD', notes: 'Hoteles tranquilos', updatedAt: '2026-11-22T15:00:00Z' }
const fail = async () => {
  throw new Error('boom')
}

function services(over: Record<string, unknown> = {}) {
  const resources = {
    getPreferences: vi.fn(async () => SAVED as unknown),
    savePreferences: vi.fn(async (body: unknown) => ({ ...SAVED, echoed: body }) as unknown),
    listTrips: async () => [],
    listReservations: async () => [],
    getTrip: async () => null,
    ...over,
  }
  const svc = { auth: { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => () => {}, email: 'a@b.co', restore: async () => true }, resources } as unknown as Services
  return { svc, resources }
}
const mount = (ui: React.ReactNode, svc: Services) =>
  render(
    <MemoryRouter>
      <AppProvider services={svc}>{ui}</AppProvider>
    </MemoryRouter>,
  )

describe('utilidades de preferencias', () => {
  it('parsePreferences: null, vacio y esquema anterior no cuentan; valores desconocidos se ignoran', () => {
    expect(parsePreferences(null)).toBeNull()
    expect(parsePreferences({ preferences: null })).toBeNull()
    expect(parsePreferences({ updatedAt: 'x', dietary: 'vegano', budgetStyle: 'ECONOMY' })).toBeNull()
    expect(parsePreferences({ travelStyles: ['BEACH', 'SPA'], pace: 'FAST' })).toEqual({ ...DEFAULT_PREFERENCES, travelStyles: ['BEACH'] })
    expect(parsePreferences({ preferences: SAVED })?.travelStyles).toEqual(['CULTURE', 'GASTRONOMY'])
  })
  it('cuerpo del PUT: los cuatro campos; notes solo con texto y recortado', () => {
    expect(toRequestBody({ ...DEFAULT_PREFERENCES, notes: '   ' })).toEqual({ travelStyles: [], pace: 'BALANCED', flightTime: 'ANY', budgetLevel: 'STANDARD' })
    expect(toRequestBody({ travelStyles: ['BEACH'], pace: 'INTENSE', flightTime: 'EVENING', budgetLevel: 'PREMIUM', notes: ' hola ' })).toEqual({
      travelStyles: ['BEACH'],
      pace: 'INTENSE',
      flightTime: 'EVENING',
      budgetLevel: 'PREMIUM',
      notes: 'hola',
    })
  })
  it('summaryLine y samePreferences', () => {
    expect(summaryLine({ ...DEFAULT_PREFERENCES, travelStyles: ['CULTURE', 'GASTRONOMY'], pace: 'RELAXED' })).toBe('Cultura · Gastronomía · Ritmo tranquilo')
    expect(summaryLine({ ...DEFAULT_PREFERENCES, flightTime: 'MORNING', budgetLevel: 'ECONOMY' })).toBe('Ritmo equilibrado · Vuelos de mañana · Presupuesto económico')
    expect(samePreferences(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES })).toBe(true)
    expect(samePreferences(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, pace: 'INTENSE' })).toBe(false)
  })
})

describe('pagina Mis preferencias', () => {
  it('carga lo guardado: chips, grupos segmentados y contador', async () => {
    const { svc } = services()
    mount(<Preferences />, svc)
    expect(await screen.findByRole('heading', { name: 'Mis preferencias' })).toBeInTheDocument()
    for (const l of ['Playa', 'Cultura', 'Gastronomía', 'Aventura', 'Vida nocturna', 'Naturaleza']) expect(screen.getByRole('button', { name: l })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cultura' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Playa' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('group', { name: 'Ritmo del viaje' })).getByRole('button', { name: 'Tranquilo' })).toHaveAttribute('aria-pressed', 'true')
    for (const l of ['Cualquiera', 'Mañana', 'Tarde', 'Noche', 'Económico', 'Estándar', 'Premium', 'Equilibrado', 'Intenso']) expect(screen.getAllByRole('button', { name: l }).length).toBeGreaterThan(0)
    expect(screen.getByText('18/200')).toBeInTheDocument()
    expect((screen.getByLabelText('Notas (opcional)') as HTMLTextAreaElement).value).toBe('Hoteles tranquilos')
  })

  it('selecciona, guarda con el cuerpo esperado y avisa', async () => {
    const { svc, resources } = services({ getPreferences: vi.fn(async () => null) })
    mount(<Preferences />, svc)
    await screen.findByRole('heading', { name: 'Mis preferencias' })
    fireEvent.click(screen.getByRole('button', { name: 'Playa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Aventura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Intenso' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Horario de vuelo' })).getByRole('button', { name: 'Mañana' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Nivel de presupuesto' })).getByRole('button', { name: 'Premium' }))
    fireEvent.change(screen.getByLabelText('Notas (opcional)'), { target: { value: 'Sin escalas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(resources.savePreferences).toHaveBeenCalledWith({ travelStyles: ['BEACH', 'ADVENTURE'], pace: 'INTENSE', flightTime: 'MORNING', budgetLevel: 'PREMIUM', notes: 'Sin escalas' }),
    )
    expect(await screen.findByText('Preferencias guardadas')).toBeInTheDocument()
  })

  it('deselecciona un estilo al pulsarlo de nuevo y respeta el limite de 200 de las notas', async () => {
    const { svc, resources } = services()
    mount(<Preferences />, svc)
    await screen.findByRole('heading', { name: 'Mis preferencias' })
    fireEvent.click(screen.getByRole('button', { name: 'Cultura' }))
    expect(screen.getByRole('button', { name: 'Cultura' })).toHaveAttribute('aria-pressed', 'false')
    const notes = screen.getByLabelText('Notas (opcional)')
    expect(notes).toHaveAttribute('maxlength', '200')
    fireEvent.change(notes, { target: { value: 'x'.repeat(200) } })
    expect(screen.getByText('200/200')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(resources.savePreferences).toHaveBeenCalled())
    expect(resources.savePreferences.mock.calls[0][0]).toMatchObject({ travelStyles: ['GASTRONOMY'] })
  })

  it('Restablecer vuelve a los valores por omision sin guardar', async () => {
    const { svc, resources } = services()
    mount(<Preferences />, svc)
    await screen.findByRole('heading', { name: 'Mis preferencias' })
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }))
    expect(screen.getByRole('button', { name: 'Cultura' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('group', { name: 'Ritmo del viaje' })).getByRole('button', { name: 'Equilibrado' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('0/200')).toBeInTheDocument()
    expect(resources.savePreferences).not.toHaveBeenCalled()
  })

  it('un error al guardar muestra el aviso y deja el boton disponible', async () => {
    const { svc } = services({ savePreferences: vi.fn(fail) })
    mount(<Preferences />, svc)
    await screen.findByRole('heading', { name: 'Mis preferencias' })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/inesperado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled()
  })

  it('estado de carga y de error con Reintentar', async () => {
    const { svc } = services({ getPreferences: vi.fn(fail) })
    mount(<Preferences />, svc)
    expect(screen.getByLabelText('Cargando')).toBeInTheDocument()
    expect(await screen.findByText('No pudimos cargar tus preferencias.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('tarjeta del Dashboard', () => {
  it('aparece solo si aun no hay preferencias', async () => {
    const none = services({ getPreferences: vi.fn(async () => null) })
    const { unmount } = mount(<Dashboard />, none.svc)
    expect(await screen.findByText('Personaliza tus recomendaciones')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configurar preferencias' })).toBeInTheDocument()
    unmount()
    mount(<Dashboard />, services().svc)
    await screen.findByText('Reservas recientes')
    expect(screen.queryByText('Personaliza tus recomendaciones')).toBeNull()
  })
  it('un item guardado con el esquema anterior cuenta como sin preferencias', async () => {
    mount(<Dashboard />, services({ getPreferences: vi.fn(async () => ({ dietary: 'vegano', updatedAt: 'x' })) }).svc)
    expect(await screen.findByText('Personaliza tus recomendaciones')).toBeInTheDocument()
  })
  it('si la lectura falla, el Dashboard sigue y no muestra la tarjeta', async () => {
    mount(<Dashboard />, services({ getPreferences: vi.fn(fail) }).svc)
    await screen.findByText('Reservas recientes')
    expect(screen.queryByText('Personaliza tus recomendaciones')).toBeNull()
  })
})

const stateWith = (data: unknown): ConversationState => reduce(initialConversation, { type: 'event', event: { type: 'ui', component: 'preferences', data } })

describe('franja del lienzo', () => {
  it('muestra "Usando tus preferencias" con el resumen y el enlace Editar', () => {
    render(
      <MemoryRouter>
        <PreferencesStrip state={stateWith({ preferences: { travelStyles: ['CULTURE', 'GASTRONOMY'], pace: 'RELAXED', flightTime: 'ANY', budgetLevel: 'STANDARD' } })} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Usando tus preferencias: Cultura · Gastronomía · Ritmo tranquilo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/preferencias')
  })
  it('con null, vacio o sin el componente no muestra nada', () => {
    for (const st of [stateWith({ preferences: null }), stateWith(null), stateWith({}), initialConversation]) {
      const { container, unmount } = render(
        <MemoryRouter>
          <PreferencesStrip state={st} />
        </MemoryRouter>,
      )
      expect(container.textContent).toBe('')
      unmount()
    }
  })
  it('preferences sigue sin crear pestana en el lienzo (regla del S6.2)', () => {
    render(
      <MemoryRouter>
        <Canvas state={stateWith({ preferences: { travelStyles: ['BEACH'], pace: 'RELAXED' } })} />
      </MemoryRouter>,
    )
    for (const t of ['Vuelos', 'Clima', 'Viaje', 'Itinerario', 'Reservas']) expect(screen.getByRole('tab', { name: new RegExp(`^${t}`) })).toBeDisabled()
    expect(screen.queryByRole('tab', { name: /Otros/ })).toBeNull()
  })
})

describe('chip del asistente', () => {
  it('Recomiendame actividades segun mis preferencias esta entre las sugerencias', () => {
    expect(SUGGESTIONS).toContain('Recomiéndame actividades según mis preferencias')
  })
})

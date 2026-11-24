import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, type Services } from '../app/AppContext'
import type { CognitoApi } from '../auth/cognito'
import { Login } from '../pages/Login'
import { CodeInput } from '../pages/login/CodeInput'
import { isStrongEnough, passwordChecks, passwordStrength } from '../pages/login/passwordRules'
import { DESTINATIONS, useTypewriter } from '../pages/login/motion'

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  )
}

function setupLogin(api?: Partial<CognitoApi>) {
  const services = {
    auth: { isSignedIn: () => false, hasStoredSession: () => false, subscribe: () => () => {}, email: null, restore: async () => false, signIn: vi.fn() },
    resources: {},
  } as unknown as Services
  const fullApi = { signUp: vi.fn(), confirmSignUp: vi.fn().mockResolvedValue(undefined), resendCode: vi.fn(), signIn: vi.fn(), refresh: vi.fn(), ...api } as unknown as CognitoApi
  render(
    <MemoryRouter>
      <AppProvider services={services}>
        <Login api={fullApi} />
      </AppProvider>
    </MemoryRouter>,
  )
  return { api: fullApi }
}

beforeEach(() => mockMatchMedia(false))
afterEach(() => vi.unstubAllGlobals())

describe('requisitos y fortaleza de la contraseña', () => {
  it('checklist: 8 caracteres, mayuscula, minuscula y numero', () => {
    expect(passwordChecks('').map((c) => c.ok)).toEqual([false, false, false, false])
    expect(passwordChecks('abc').map((c) => c.ok)).toEqual([false, false, true, false])
    expect(passwordChecks('Abcdefg1').every((c) => c.ok)).toBe(true)
    expect(isStrongEnough('abcdefg1')).toBe(false) // sin mayuscula
    expect(isStrongEnough('Abcdef1')).toBe(false) // 7 caracteres
  })
  it('fortaleza: debil, media, fuerte', () => {
    expect(passwordStrength('').level).toBe('empty')
    expect(passwordStrength('abc').level).toBe('weak')
    expect(passwordStrength('Abcdefg1').level).toBe('medium')
    expect(passwordStrength('Abcdefghijk1').level).toBe('strong')
  })
  it('en Crear cuenta los ✓ se marcan en vivo y la barra sube', () => {
    setupLogin()
    fireEvent.click(screen.getByRole('tab', { name: 'Crear cuenta' }))
    const items = () => screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-ok'))
    expect(items().map((li) => li.getAttribute('data-ok'))).toEqual(['false', 'false', 'false', 'false'])
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Abcdefg1' } })
    expect(items().map((li) => li.getAttribute('data-ok'))).toEqual(['true', 'true', 'true', 'true'])
    expect(screen.getByRole('progressbar', { name: 'Fortaleza de la contraseña' })).toHaveAttribute('aria-valuetext', 'Media')
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'abc' } })
    expect(screen.getByRole('progressbar', { name: 'Fortaleza de la contraseña' })).toHaveAttribute('aria-valuetext', 'Débil')
  })
  it('una contraseña débil no llama a Cognito y muestra el aviso', async () => {
    const { api } = setupLogin()
    fireEvent.click(screen.getByRole('tab', { name: 'Crear cuenta' }))
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta', hidden: false }))
    expect(await screen.findByText(/mínimo 8 caracteres/)).toBeInTheDocument()
    expect(api.signUp).not.toHaveBeenCalled()
  })
})

describe('mostrar u ocultar la contraseña', () => {
  it('boton accesible que alterna el tipo del campo', () => {
    setupLogin()
    const input = screen.getByLabelText('Contraseña') as HTMLInputElement
    expect(input.type).toBe('password')
    const btn = screen.getByRole('button', { name: 'Mostrar contraseña' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(input.type).toBe('password')
  })
  it('avisa de Bloq Mayus mientras esta activo', () => {
    setupLogin()
    const input = screen.getByLabelText('Contraseña')
    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true })
    expect(screen.getByText(/Bloq Mayús está activado/)).toBeInTheDocument()
    fireEvent.keyUp(input, { key: 'a', modifierCapsLock: false })
    expect(screen.queryByText(/Bloq Mayús está activado/)).toBeNull()
  })
})

function CodeHarness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <CodeInput value={v} onChange={setV} />
      <output data-testid="value">{v}</output>
    </>
  )
}
const box = (n: number) => screen.getByLabelText(`Dígito ${n} de 6`) as HTMLInputElement

describe('casillas del código', () => {
  it('son 6 y avanzan solas al escribir', () => {
    render(<CodeHarness />)
    expect(screen.getAllByLabelText(/Dígito \d de 6/)).toHaveLength(6)
    box(1).focus()
    fireEvent.change(box(1), { target: { value: '4' } })
    expect(document.activeElement).toBe(box(2))
    fireEvent.change(box(2), { target: { value: '8' } })
    expect(document.activeElement).toBe(box(3))
    expect(screen.getByTestId('value').textContent).toBe('48')
  })
  it('ignora lo que no es un digito', () => {
    render(<CodeHarness />)
    fireEvent.change(box(1), { target: { value: 'a' } })
    expect(screen.getByTestId('value').textContent).toBe('')
  })
  it('pegar el codigo completo llena las 6 casillas (ignora espacios y letras)', () => {
    render(<CodeHarness />)
    fireEvent.paste(box(1), { clipboardData: { getData: () => ' 123 456 ' } })
    expect(screen.getByTestId('value').textContent).toBe('123456')
    for (let i = 1; i <= 6; i++) expect(box(i).value).toBe(String(i))
    expect(document.activeElement).toBe(box(6))
  })
  it('Backspace en una casilla vacia borra la anterior y retrocede', () => {
    render(<CodeHarness initial="12" />)
    box(3).focus()
    fireEvent.keyDown(box(3), { key: 'Backspace' })
    expect(screen.getByTestId('value').textContent).toBe('1')
    expect(document.activeElement).toBe(box(2))
  })
  it('Backspace con digito lo borra en su sitio; las flechas mueven el foco', () => {
    render(<CodeHarness initial="123" />)
    fireEvent.change(box(2), { target: { value: '' } })
    expect(screen.getByTestId('value').textContent).toBe('13')
    box(2).focus()
    fireEvent.keyDown(box(2), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(box(3))
    fireEvent.keyDown(box(3), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(box(2))
  })
  it('en Confirmar, el codigo de las casillas se envia a Cognito y se muestra el ✓', async () => {
    const { api } = setupLogin()
    fireEvent.click(screen.getByRole('tab', { name: 'Confirmar código' }))
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'a@b.co' } })
    fireEvent.paste(box(1), { clipboardData: { getData: () => '987654' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cuenta' }))
    await waitFor(() => expect(api.confirmSignUp).toHaveBeenCalledWith('a@b.co', '987654'))
    expect(await screen.findByText('¡Cuenta confirmada!')).toBeInTheDocument()
  })
})

describe('movimiento reducido', () => {
  it('el contenedor lo marca y la maquina de escribir queda fija', () => {
    mockMatchMedia(true)
    const { container } = render(
      <MemoryRouter>
        <AppProvider services={{ auth: { isSignedIn: () => false, hasStoredSession: () => false, subscribe: () => () => {}, email: null, restore: async () => false }, resources: {} } as unknown as Services}>
          <Login api={{} as CognitoApi} />
        </AppProvider>
      </MemoryRouter>,
    )
    expect(container.querySelector('.login-page')).toHaveAttribute('data-reduced-motion', 'true')
    expect(container.querySelector('.typed')?.textContent).toBe(DESTINATIONS[0])
  })
  it('sin la preferencia, el contenedor lo indica y la maquina de escribir rota', () => {
    vi.useFakeTimers()
    const { container } = render(
      <MemoryRouter>
        <AppProvider services={{ auth: { isSignedIn: () => false, hasStoredSession: () => false, subscribe: () => () => {}, email: null, restore: async () => false }, resources: {} } as unknown as Services}>
          <Login api={{} as CognitoApi} />
        </AppProvider>
      </MemoryRouter>,
    )
    expect(container.querySelector('.login-page')).toHaveAttribute('data-reduced-motion', 'false')
    expect(container.querySelector('.typed')?.textContent).toBe('')
    act(() => {
      vi.advanceTimersByTime(400 + 85 * 9)
    })
    expect(container.querySelector('.typed')?.textContent).toBe('Cartagena')
    act(() => {
      vi.advanceTimersByTime(1600 + 43 * 9 + 350 + 85 * 8 + 10)
    })
    expect(container.querySelector('.typed')?.textContent).toBe('Medellín')
    vi.useRealTimers()
  })
  it('useTypewriter con reduced no usa temporizadores', () => {
    vi.useFakeTimers()
    function T() {
      return <span data-testid="t">{useTypewriter(['A', 'B'], true)}</span>
    }
    render(<T />)
    expect(screen.getByTestId('t').textContent).toBe('A')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})

describe('textos de la pagina', () => {
  it('nota para el evaluador y pestañas Entrar / Crear cuenta / Confirmar código', () => {
    setupLogin()
    expect(screen.getByText('¿Evaluador? Usa la cuenta indicada en la entrega o crea una nueva.')).toBeInTheDocument()
    for (const t of ['Entrar', 'Crear cuenta', 'Confirmar código']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument()
    expect(screen.getByText('Vuelos reales con agentes de IA')).toBeInTheDocument()
    expect(screen.getByText('Clima del destino día a día')).toBeInTheDocument()
    expect(screen.getByText('Itinerario y reservas en un solo lugar')).toBeInTheDocument()
  })
})

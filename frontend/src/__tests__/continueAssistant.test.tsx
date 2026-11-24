import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppProvider, useApp, type Services } from '../app/AppContext'
import type { AgentEvent } from '../agent/events'
import { Conversation, type StreamLike } from '../agent/conversation'
import { SESSION_IDLE_MS, SessionTracker } from '../agent/session'
import { DEFAULT_QUESTION, continuePrompt, lastQuestion } from '../agent/continuePrompt'
import { initialConversation, reduce, type ConversationState } from '../agent/reducer'
import { Flights } from '../pages/Flights'
import { Weather } from '../pages/Weather'

const TEXT_Q = 'Encontré 3 vuelos. ¿Quieres que registre el viaje a Cartagena?'
const QUESTION = '¿Quieres que registre el viaje a Cartagena?'

function fakeStream(reply: AgentEvent[]): StreamLike {
  return {
    async stream(_prompt, _sessionId, _signal, onEvent) {
      reply.forEach(onEvent)
      return { status: 'done' }
    },
  }
}

function Probe() {
  const { assistant } = useApp()
  return <output data-testid="assistant-items">{assistant.getState().items.map((i) => (i.kind === 'text' || i.kind === 'user' ? i.text : i.kind)).join('|')}</output>
}

function setup(page: 'flights' | 'weather', reply: AgentEvent[], seed?: (c: Conversation) => void) {
  const services = {
    auth: { isSignedIn: () => true, hasStoredSession: () => false, subscribe: () => () => {}, email: 'a@b.co', restore: async () => true },
    resources: {},
    stream: fakeStream(reply),
  } as unknown as Services
  const ref: { assistant: Conversation | null; seeded: boolean } = { assistant: null, seeded: false }
  function Grab() {
    const { assistant } = useApp()
    ref.assistant = assistant
    if (seed && !ref.seeded) {
      ref.seeded = true
      seed(assistant)
    }
    return null
  }
  render(
    <MemoryRouter initialEntries={[`/${page}`]}>
      <AppProvider services={services}>
        <Grab />
        <Routes>
          <Route path="/flights" element={<Flights />} />
          <Route path="/weather" element={<Weather />} />
          <Route path="/asistente" element={<Probe />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  )
  return { assistant: () => ref.assistant as Conversation }
}

describe('lastQuestion', () => {
  it('toma la ultima frase si el texto termina en ?', () => {
    expect(lastQuestion(TEXT_Q)).toBe(QUESTION)
    expect(lastQuestion('Listo.\n\n**¿Quieres que cree el viaje?**')).toBe('¿Quieres que cree el viaje?')
    expect(lastQuestion('¿Cuántas personas viajan? ¿Y con qué presupuesto?')).toBe('¿Y con qué presupuesto?')
  })
  it('sin ? al final no hay pregunta', () => {
    expect(lastQuestion('Aquí tienes los vuelos.')).toBeNull()
    expect(lastQuestion('¿Quieres algo? Avísame.')).toBeNull()
  })
})

describe('continuePrompt', () => {
  const withText = (text: string, running = false): ConversationState => {
    const s = reduce(reduce(initialConversation, { type: 'send', text: 'hola' }), { type: 'event', event: { type: 'text', delta: text } })
    return running ? s : reduce(s, { type: 'finish' })
  }
  it('con la respuesta terminada: la pregunta, o la frase por omision', () => {
    expect(continuePrompt(withText(TEXT_Q))?.question).toBe(QUESTION)
    expect(continuePrompt(withText('Aquí están.'))?.question).toBe(DEFAULT_QUESTION)
  })
  it('sin texto o mientras responde no hay bloque', () => {
    expect(continuePrompt(initialConversation)).toBeNull()
    expect(continuePrompt(withText(TEXT_Q, true))).toBeNull()
  })
})

describe('transferencia de la conversacion', () => {
  const textStream = (used: string[]): StreamLike => ({
    stream: async (_p, sid, _a, onEvent) => {
      used.push(sid)
      onEvent({ type: 'text', delta: 'ok' })
      return { status: 'done' }
    },
  })

  it('copia mensajes y resultados y sigue en la MISMA sesion', async () => {
    const clock = { t: 1_000_000 }
    const page = new Conversation({ client: textStream([]), sessions: new SessionTracker(() => clock.t, () => 'p') })
    const used: string[] = []
    const asst = new Conversation({ client: textStream(used), sessions: new SessionTracker(() => clock.t, () => 'otra') })
    await page.send('busca vuelos')
    asst.adopt(page.snapshot())
    expect(asst.getState().items).toEqual(page.getState().items)
    expect(asst.getState().running).toBe(false)
    clock.t += 60_000
    await asst.send('sí, regístralo')
    expect(used).toEqual(['tp-web-p'])
    expect(asst.getState().items.some((i) => i.kind === 'notice')).toBe(false)
  })

  it('si pasaron mas de 14 min, el siguiente envio abre una sesion nueva y avisa', async () => {
    const clock = { t: 1_000_000 }
    const page = new Conversation({ client: textStream([]), sessions: new SessionTracker(() => clock.t, () => 'p') })
    const used: string[] = []
    const asst = new Conversation({ client: textStream(used), sessions: new SessionTracker(() => clock.t, () => 'nueva') })
    await page.send('hola')
    asst.adopt(page.snapshot())
    clock.t += SESSION_IDLE_MS + 1000
    await asst.send('sigo aquí')
    expect(used).toEqual(['tp-web-nueva'])
    expect(asst.getState().items.some((i) => i.kind === 'notice')).toBe(true)
  })
})

describe('pagina Vuelos: pregunta sin respuesta', () => {
  const REPLY: AgentEvent[] = [{ type: 'text', delta: TEXT_Q }, { type: 'done' }]
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const search = () => {
    fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'Bogotá, Colombia' } })
    fireEvent.change(screen.getByLabelText('Destino'), { target: { value: 'Cartagena, Colombia' } })
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: day(5) } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar vuelos' }))
  }

  it('muestra la pregunta destacada y los dos botones; Sí transfiere y navega a /asistente', async () => {
    const { assistant } = setup('flights', REPLY)
    search()
    expect(await screen.findByText(QUESTION)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No, descartar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, continuar en el asistente' }))
    expect(await screen.findByTestId('assistant-items')).toHaveTextContent(TEXT_Q)
    expect(assistant().getState().items.length).toBeGreaterThan(1)
  })

  it('No, descartar oculta el bloque', async () => {
    setup('flights', REPLY)
    search()
    await screen.findByText(QUESTION)
    fireEvent.click(screen.getByRole('button', { name: 'No, descartar' }))
    expect(screen.queryByText(QUESTION)).toBeNull()
    expect(screen.queryByRole('button', { name: 'No, descartar' })).toBeNull()
  })

  it('con conversacion previa en el asistente pide confirmacion: Cancelar conserva, Reemplazar sustituye', async () => {
    const { assistant } = setup('flights', REPLY, (c) =>
      c.adopt({ state: reduce(initialConversation, { type: 'send', text: 'conversación previa' }), session: { id: 'tp-web-old', lastEventAt: Date.now(), hadActivity: true }, lastPrompt: '' }),
    )
    search()
    await screen.findByText(QUESTION)
    fireEvent.click(screen.getByRole('button', { name: 'Sí, continuar en el asistente' }))
    expect(await screen.findByText('¿Reemplazar la conversación actual del asistente?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByText('¿Reemplazar la conversación actual del asistente?')).toBeNull())
    expect(assistant().getState().items.some((i) => i.kind === 'user' && i.text === 'conversación previa')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sí, continuar en el asistente' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reemplazar' }))
    expect(await screen.findByTestId('assistant-items')).toHaveTextContent(TEXT_Q)
    expect(assistant().getState().items.some((i) => i.kind === 'user' && i.text === 'conversación previa')).toBe(false)
  })

  it('el boton de la cabecera usa la misma transferencia', async () => {
    setup('flights', REPLY)
    search()
    await screen.findByText(QUESTION)
    fireEvent.click(screen.getByRole('button', { name: 'Continuar en el asistente' }))
    expect(await screen.findByTestId('assistant-items')).toHaveTextContent(TEXT_Q)
  })
})

describe('pagina Clima', () => {
  it('sin pregunta en la respuesta muestra la frase por omision', async () => {
    setup('weather', [{ type: 'text', delta: 'Hará sol.' }, { type: 'done' }])
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
    fireEvent.change(screen.getByLabelText('Ciudad'), { target: { value: 'Cartagena, Colombia' } })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: day(1) } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: day(3) } })
    fireEvent.click(screen.getByRole('button', { name: 'Consultar clima' }))
    expect(await screen.findByText(DEFAULT_QUESTION)).toBeInTheDocument()
  })
})

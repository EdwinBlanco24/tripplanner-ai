import { describe, expect, it } from 'vitest'
import { SseParser } from '../agent/sse'

const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

describe('SseParser', () => {
  it('lee eventos completos', () => {
    const p = new SseParser()
    const out = p.push(ev({ type: 'text', delta: 'Hola' }) + ev({ type: 'done' }))
    expect(out).toEqual([{ type: 'text', delta: 'Hola' }, { type: 'done' }])
  })

  it('un evento partido en varios chunks (incluso a mitad del JSON)', () => {
    const p = new SseParser()
    const full = ev({ type: 'ui', component: 'flights', data: { flights: [{ flightNumber: 'AV1' }] } })
    const out: unknown[] = []
    for (let i = 0; i < full.length; i += 7) out.push(...p.push(full.slice(i, i + 7)))
    expect(out).toEqual([{ type: 'ui', component: 'flights', data: { flights: [{ flightNumber: 'AV1' }] } }])
  })

  it('CRLF, incluso si \\r y \\n llegan en chunks distintos', () => {
    const p = new SseParser()
    const raw = 'data: {"type":"text","delta":"a"}\r\n\r\ndata: {"type":"done"}\r\n\r\n'
    const out = [...p.push(raw.slice(0, 33)), ...p.push(raw.slice(33, 34)), ...p.push(raw.slice(34))]
    // se parte justo entre \r y \n de la primera linea en blanco
    expect(out).toEqual([{ type: 'text', delta: 'a' }, { type: 'done' }])
  })

  it('varios eventos en un solo chunk', () => {
    const p = new SseParser()
    const out = p.push(ev({ type: 'status', agent: 'flights', message: 'x' }) + ev({ type: 'text', delta: 'y' }) + ev({ type: 'done' }))
    expect(out.map((e) => e.type)).toEqual(['status', 'text', 'done'])
  })

  it('ignora comentarios, otros campos y lineas que no son data', () => {
    const p = new SseParser()
    const out = p.push(': keep-alive\n\nevent: ping\nid: 4\n\n' + 'event: x\ndata: {"type":"done"}\n\n')
    expect(out).toEqual([{ type: 'done' }])
  })

  it('ignora JSON invalido y tipos desconocidos sin romper el resto', () => {
    const p = new SseParser()
    const out = p.push('data: {no json\n\n' + ev({ type: 'raro', x: 1 }) + ev({ type: 'ui', component: '' }) + ev({ type: 'text', delta: 'ok' }))
    expect(out).toEqual([{ type: 'text', delta: 'ok' }])
  })

  it('data con espacio opcional y sin espacio', () => {
    const p = new SseParser()
    expect(p.push('data:{"type":"done"}\n\n')).toEqual([{ type: 'done' }])
  })

  it('sin done: flush entrega lo pendiente sin linea en blanco final; el parser no inventa done', () => {
    const p = new SseParser()
    const out = p.push(ev({ type: 'text', delta: 'a' }) + 'data: {"type":"text","delta":"b"}')
    expect(out).toEqual([{ type: 'text', delta: 'a' }])
    expect(p.flush()).toEqual([{ type: 'text', delta: 'b' }])
    expect(p.flush()).toEqual([])
  })
})

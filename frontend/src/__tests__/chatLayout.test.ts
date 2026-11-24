import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles/app.css', 'utf8')
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`)
  expect(i, `falta la regla ${selector}`).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf('}', i) + 1)
}

describe('estilos de tablas del chat y ancho del chat', () => {
  it('el contenedor de la tabla hace el scroll horizontal', () => expect(rule('.md-table-wrap')).toContain('overflow-x: auto'))
  it('las celdas no cortan palabras (nowrap) y usan 13px con padding 6px 10px', () => {
    const r = rule('.md-table th, .md-table td')
    expect(r).toContain('white-space: nowrap')
    expect(r).toContain('padding: 6px 10px')
    expect(r).toContain('#e2e8f0')
    expect(rule('.md-table')).toContain('font-size: 13px')
  })
  it('thead #F1F5F9 con texto #0F172A y filas alternas sutiles', () => {
    expect(rule('.md-table thead th')).toMatch(/#f1f5f9/)
    expect(rule('.md-table thead th')).toMatch(/#0f172a/)
    expect(css).toContain('.md-table tbody tr:nth-child(even)')
  })
  it('chat de escritorio: clamp(420px, 40%, 560px); movil sin cambios (una columna)', () => {
    expect(rule('.assistant-grid')).toContain('clamp(420px, 40%, 560px) minmax(0, 1fr)')
    expect(css).toMatch(/@media \(max-width: 900px\) \{\s+\.assistant-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  })
})

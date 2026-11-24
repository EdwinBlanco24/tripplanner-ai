import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SafeMarkdown, isSafeHref } from '../agent/ui/SafeMarkdown'

describe('SafeMarkdown', () => {
  it('no interpreta HTML crudo: ni scripts ni elementos', () => {
    const { container } = render(<SafeMarkdown text={'Hola <script>alert(1)</script> <img src=x onerror=alert(1)> <b>negrita</b>'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')
  })

  it('enlaces http/https se abren en otra pestana con noopener noreferrer', () => {
    render(<SafeMarkdown text="[Kiwi](https://kiwi.com/u/abc)" />)
    const a = screen.getByRole('link', { name: 'Kiwi' })
    expect(a).toHaveAttribute('href', 'https://kiwi.com/u/abc')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('javascript:, data: y vbscript: no producen enlaces', () => {
    const { container } = render(<SafeMarkdown text={'[x](javascript:alert(1)) [y](data:text/html;base64,AAAA) [z](vbscript:msgbox) [w](JaVaScRiPt:alert(1))'} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('x')
  })

  it('las imagenes no se cargan (se muestra el texto alternativo)', () => {
    const { container } = render(<SafeMarkdown text="![logo](https://tracker.example/p.png)" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('logo')
  })

  it('tablas GFM con contenedor desplazable', () => {
    const { container } = render(<SafeMarkdown text={'| A | B |\n|---|---|\n| 1 | 2 |'} />)
    expect(container.querySelector('table.md-table')).not.toBeNull()
    expect(container.querySelector('.md-table-wrap')).not.toBeNull()
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument()
  })

  it('una tabla de 6 columnas queda dentro del contenedor con scroll, sin HTML crudo', () => {
    const md = '| Fecha | Día | Máx | Mín | Lluvia | Condición |\n|---|---|---|---|---|---|\n| 2026-12-04 | viernes | 32 | 27 | 83% | Llovizna ligera |'
    const { container } = render(<SafeMarkdown text={md} />)
    const wrap = container.querySelector('.md-table-wrap')!
    expect(wrap.querySelector('table.md-table')).not.toBeNull()
    expect(container.querySelectorAll('.md-table-wrap')).toHaveLength(1)
    expect(wrap.querySelectorAll('thead th')).toHaveLength(6)
    expect(container.querySelector('script')).toBeNull()
  })

  it('isSafeHref', () => {
    expect(isSafeHref('https://a.com')).toBe(true)
    expect(isSafeHref('http://a.com')).toBe(true)
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.co', '/relativo', '', undefined]) expect(isSafeHref(bad)).toBe(false)
  })
})

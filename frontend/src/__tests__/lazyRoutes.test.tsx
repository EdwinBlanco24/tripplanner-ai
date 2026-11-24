import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RouteFallback } from '../components/RouteFallback'

const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf-8')

describe('rutas con carga diferida', () => {
  it('asistente, vuelos, clima y comprobante se cargan con React.lazy y Suspense', () => {
    for (const page of ['Assistant', 'Flights', 'Weather', 'Voucher']) {
      expect(app).toContain(`const ${page} = lazy(() => import('./pages/${page}')`)
      expect(app).not.toContain(`import { ${page} } from`)
      expect(app).toContain(`lazyPage(<${page} />)`)
    }
    expect(app).toContain('<Suspense fallback={<RouteFallback />}>')
  })
  it('mientras carga se ve un esqueleto accesible', () => {
    render(<RouteFallback />)
    expect(screen.getByLabelText('Cargando')).toHaveAttribute('aria-busy', 'true')
  })
})

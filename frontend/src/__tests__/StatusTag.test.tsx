import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusTag } from '../components/StatusTag'

describe('StatusTag', () => {
  it.each([
    ['SIMULADA', 'Simulada', 'status-simulada'],
    ['PENDIENTE', 'Pendiente', 'status-pendiente'],
    ['CONFIRMADA', 'Confirmada', 'status-confirmada'],
  ] as const)('%s muestra texto y clase de color', (status, text, cls) => {
    render(<StatusTag status={status} />)
    expect(screen.getByText(text)).toHaveClass(cls)
  })
})

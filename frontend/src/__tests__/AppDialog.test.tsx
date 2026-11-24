import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppDialog } from '../components/AppDialog'

function Harness({ onHide }: { onHide: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <AppDialog
      visible={open}
      header="Titulo"
      onHide={() => {
        onHide()
        setOpen(false)
      }}
    >
      <p>Contenido</p>
    </AppDialog>
  )
}

const isMaximized = () => document.querySelector('.p-dialog')?.classList.contains('p-dialog-maximized') ?? false
const maximizeButton = () => document.querySelector('.p-dialog-header-maximize') as HTMLElement

describe('AppDialog', () => {
  it('muestra el boton de ampliar junto a la X', () => {
    render(<Harness onHide={() => {}} />)
    expect(maximizeButton()).toBeTruthy()
    expect(document.querySelector('.p-dialog-header-close')).toBeTruthy()
  })

  it('el boton de ampliar alterna pantalla completa', () => {
    render(<Harness onHide={() => {}} />)
    expect(isMaximized()).toBe(false)
    fireEvent.click(maximizeButton())
    expect(isMaximized()).toBe(true)
    fireEvent.click(maximizeButton())
    expect(isMaximized()).toBe(false)
  })

  it('Esc sin ampliar cierra el dialogo', () => {
    const onHide = vi.fn()
    render(<Harness onHide={onHide} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('Esc ampliado sale de pantalla completa sin cerrar; el segundo Esc cierra', () => {
    const onHide = vi.fn()
    render(<Harness onHide={onHide} />)
    fireEvent.click(maximizeButton())
    expect(isMaximized()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(isMaximized()).toBe(false)
    expect(onHide).not.toHaveBeenCalled()
    expect(screen.getByText('Contenido')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('otras teclas no cierran', () => {
    const onHide = vi.fn()
    render(<Harness onHide={onHide} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onHide).not.toHaveBeenCalled()
  })
})

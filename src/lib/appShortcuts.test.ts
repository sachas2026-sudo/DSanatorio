import { describe, expect, it, vi } from 'vitest'
import { ALT_NUMBER_ROUTES, bindAppShortcuts } from './appShortcuts'

describe('bindAppShortcuts', () => {
  it('navega con Alt+número si hay permiso', () => {
    const navigate = vi.fn()
    const canAccessPath = vi.fn(() => true)
    const onShowHelp = vi.fn()

    const unbind = bindAppShortcuts(navigate, canAccessPath, onShowHelp)

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '4', altKey: true, bubbles: true }),
    )

    expect(navigate).toHaveBeenCalledWith('/agenda')
    unbind()
  })

  it('no navega a rutas admin sin permiso', () => {
    const navigate = vi.fn()
    const canAccessPath = (path: string) => path !== '/configuracion'
    const onShowHelp = vi.fn()

    const unbind = bindAppShortcuts(navigate, canAccessPath, onShowHelp)

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '7', altKey: true, bubbles: true }),
    )

    expect(navigate).not.toHaveBeenCalled()
    unbind()
  })

  it('abre ayuda con F1', () => {
    const navigate = vi.fn()
    const canAccessPath = vi.fn(() => true)
    const onShowHelp = vi.fn()

    const unbind = bindAppShortcuts(navigate, canAccessPath, onShowHelp)

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F1', bubbles: true }),
    )

    expect(onShowHelp).toHaveBeenCalled()
    unbind()
  })

  it('ignora atajos mientras se escribe en un input', () => {
    const navigate = vi.fn()
    const canAccessPath = vi.fn(() => true)
    const onShowHelp = vi.fn()
    const input = document.createElement('input')
    document.body.appendChild(input)

    const unbind = bindAppShortcuts(navigate, canAccessPath, onShowHelp)

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '1',
        altKey: true,
        bubbles: true,
      }),
    )

    expect(navigate).not.toHaveBeenCalled()
    unbind()
    input.remove()
  })
})

describe('ALT_NUMBER_ROUTES', () => {
  it('incluye las secciones principales', () => {
    expect(ALT_NUMBER_ROUTES['1']).toBe('/')
    expect(ALT_NUMBER_ROUTES['5']).toBe('/pagos')
  })
})

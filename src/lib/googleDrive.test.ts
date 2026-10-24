import { describe, expect, it } from 'vitest'
import { needsGoogleDriveSetup } from './googleDrive'
import type { AppSettings } from '../types'

const base: AppSettings = {
  email: '',
  emailGerente: '',
  telefonoGerente: '',
  clave: '',
  telefono: '',
  cuit: '',
}

describe('needsGoogleDriveSetup', () => {
  it('muestra asistente en instalación nueva', () => {
    expect(needsGoogleDriveSetup(base)).toBe(true)
  })

  it('no muestra asistente si ya se completó', () => {
    expect(
      needsGoogleDriveSetup({ ...base, googleDriveSetupCompletado: true }),
    ).toBe(false)
  })

  it('no muestra asistente si el usuario desactivó Drive', () => {
    expect(
      needsGoogleDriveSetup({
        ...base,
        googleDriveDeshabilitado: true,
      }),
    ).toBe(false)
  })

  it('no muestra asistente si hay ruta custom', () => {
    expect(
      needsGoogleDriveSetup({
        ...base,
        rutaGoogleDriveCustom: 'G:\\Mi unidad',
      }),
    ).toBe(false)
  })
})

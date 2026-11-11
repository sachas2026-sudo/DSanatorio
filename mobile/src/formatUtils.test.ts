import { describe, it, expect } from 'vitest'
import { formatDoctorName, getDoctorInitials } from './formatUtils'

describe('formatUtils', () => {
  it('convierte nombres en mayúsculas a mayúscula inicial respetando partículas y apellidos compuestos', () => {
    expect(formatDoctorName('CABALLERO, YOEL')).toBe('Caballero, Yoel')
    expect(formatDoctorName('SENESTRARI, MARIA FERNANDA')).toBe('Senestrari, Maria Fernanda')
    expect(formatDoctorName('DE LA VEGA, JUAN CARLOS')).toBe('de la Vega, Juan Carlos')
    expect(formatDoctorName("O'HIGGINS, PABLO")).toBe("O'Higgins, Pablo")
    expect(formatDoctorName('MCDONALD, IAN')).toBe('McDonald, Ian')
    expect(formatDoctorName('PEREZ-REVERTE, ARTURO')).toBe('Perez-Reverte, Arturo')
  })

  it('remueve títulos prefijados como Dr., Dra., Lic. si vienen del backend o caché legacy', () => {
    expect(formatDoctorName('Dr. CABALLERO, YOLANDA')).toBe('Caballero, Yolanda')
    expect(formatDoctorName('Lic. OCAMPO, SILVANA')).toBe('Ocampo, Silvana')
    expect(formatDoctorName('Dra. SENESTRARI, MARIA FERNANDA')).toBe('Senestrari, Maria Fernanda')
  })

  it('obtiene iniciales correctas de apellido y nombre', () => {
    expect(getDoctorInitials('Caballero, Yolanda')).toBe('CY')
    expect(getDoctorInitials('Ocampo, Silvana')).toBe('OS')
    expect(getDoctorInitials('Dr. Aguirre, Rafael')).toBe('AR')
  })
})


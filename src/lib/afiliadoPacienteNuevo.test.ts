import { describe, it, expect } from 'vitest'
import { registrarContratanteConPacienteNuevoBackend } from './afiliadoPacienteNuevo'

describe('registrarContratanteConPacienteNuevoBackend', () => {
  it('crea paciente y afiliado con todos los campos correspondientes', async () => {
    const res = await registrarContratanteConPacienteNuevoBackend({
      patientId: 'p_test_1',
      dni: '38111222',
      apellido: 'GOMEZ',
      nombre: 'CARLOS',
      fechaNacimiento: '1992-04-15',
      planId: 'plan_ind',
      planNombre: 'Individual',
      fechaInicio: '2026-11-09',
      afiliadoId: 'afil_p_test_1',
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.patient.id).toBe('p_test_1')
      expect(res.patient.dni).toBe('38111222')
      expect(res.patient.apellido).toBe('GOMEZ')
      expect(res.patient.nombre).toBe('CARLOS')
      expect(res.patient.fechaNacimiento).toBe('1992-04-15')
      expect(res.patient.obraSocial).toBe('Individual')

      expect(res.afiliado.id).toBe('afil_p_test_1')
      expect(res.afiliado.patientId).toBe('p_test_1')
      expect(res.afiliado.planId).toBe('plan_ind')
      expect(res.afiliado.fechaInicio).toBe('2026-11-09')
      expect(res.afiliado.activo).toBe(true)
    }
  })
})


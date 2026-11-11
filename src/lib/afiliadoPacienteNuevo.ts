import { invoke, isTauri } from '@tauri-apps/api/core'
import type { Patient, Afiliado } from '../types'
import { isClientMode } from './appMode'
import { clientApi, ensureApiOk } from './clientApi'

export type RegistrarContratanteConPacienteNuevoParams = {
  patientId: string
  dni: string
  apellido: string
  nombre: string
  fechaNacimiento: string
  planId: string
  planNombre: string
  fechaInicio: string
  afiliadoId?: string
}

export type RegistrarContratanteConPacienteNuevoResult = {
  patient: Patient
  afiliado: Afiliado
}

export type RegistrarContratanteConPacienteNuevoResponse =
  | { ok: true; patient: Patient; afiliado: Afiliado }
  | { ok: false; error: string }

export async function registrarContratanteConPacienteNuevoBackend(
  params: RegistrarContratanteConPacienteNuevoParams,
): Promise<RegistrarContratanteConPacienteNuevoResponse> {
  try {
    if (isTauri()) {
      if (await isClientMode()) {
        const reply = await clientApi<RegistrarContratanteConPacienteNuevoResult>(
          'POST',
          '/api/afiliados/con-paciente-nuevo',
          params,
        )
        ensureApiOk(reply)
        return { ok: true, patient: reply.body.patient, afiliado: reply.body.afiliado }
      }
      const result = await invoke<RegistrarContratanteConPacienteNuevoResult>(
        'registrar_contratante_con_paciente_nuevo',
        { req: params },
      )
      return { ok: true, patient: result.patient, afiliado: result.afiliado }
    }

    // Fallback para entorno web / test
    const patient: Patient = {
      id: params.patientId,
      nombre: params.nombre.trim(),
      apellido: params.apellido.trim(),
      dni: params.dni.trim(),
      telefono: '',
      email: '',
      domicilio: '',
      localidad: '',
      fechaNacimiento: params.fechaNacimiento.trim(),
      obraSocial: params.planNombre.trim(),
      notas: '',
      activo: true,
    }
    const afilId = params.afiliadoId || `afil_${params.patientId}`
    const afiliado: Afiliado = {
      id: afilId,
      patientId: params.patientId,
      planId: params.planId,
      fechaInicio: params.fechaInicio,
      activo: true,
      obraSocialAnterior: '',
      adherentes: [],
    }
    return { ok: true, patient, afiliado }
  } catch (err: any) {
    const msg = typeof err === 'string' ? err : err?.message || 'Error al registrar paciente y contratante.'
    return { ok: false, error: msg }
  }
}

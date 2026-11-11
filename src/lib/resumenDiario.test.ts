import { describe, it, expect } from 'vitest'
import { calcularResumenDiario } from './resumenDiario'
import { EMPTY_APP_DATA } from './appStateLoad'
import type { AppData } from '../types'

describe('calcularResumenDiario', () => {
  it('calcula totales de pagos y honorarios correctamente', () => {
    const data: AppData = {
      ...EMPTY_APP_DATA,
      doctors: [
        { id: 'doc1', apellido: 'Gómez', nombre: 'Juan', activo: true, porcentaje: 70 },
      ],
      payments: [
        {
          id: 'pay1',
          patientId: 'pac1',
          doctorId: 'doc1',
          citaId: null,
          monto: 10000,
          fecha: '2026-11-03T10:30:00',
          metodo: 'Efectivo',
          notas: '',
          registradoPor: 'Aguirre Mary',
        },
        {
          id: 'pay2',
          patientId: 'pac2',
          doctorId: 'doc1',
          citaId: null,
          monto: 5000,
          fecha: '2026-11-03T16:00:00',
          metodo: 'Transferencia',
          notas: '',
          registradoPor: 'Barua Andrea',
        },
      ],
      appointments: [
        {
          id: 'app1',
          patientId: 'pac1',
          doctorId: 'doc1',
          fechaHora: '2026-11-03T10:30:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'atendido',
        },
        {
          id: 'app2',
          patientId: 'pac2',
          doctorId: 'doc1',
          fechaHora: '2026-11-03T16:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'programado',
        },
      ],
    }

    const resumen = calcularResumenDiario(data, '2026-11-03')

    expect(resumen.fecha).toBe('2026-11-03')
    expect(resumen.total_cobrado).toBe(15000)
    expect(resumen.total_efectivo).toBe(10000)
    expect(resumen.total_transferencia).toBe(5000)
    expect(resumen.recaudacion_manana).toBe(10000)
    expect(resumen.recaudacion_tarde).toBe(5000)
    expect(resumen.recaudacion_mary).toBe(10000)
    expect(resumen.recaudacion_andrea).toBe(5000)
    expect(resumen.turnos_totales).toBe(2)
    expect(resumen.turnos_atendidos).toBe(1)
    expect(resumen.turnos_pendientes).toBe(1)
    expect(resumen.turnos_cancelados).toBe(0)
    expect(resumen.turnos_totales).toBe(
      resumen.turnos_atendidos + resumen.turnos_pendientes + resumen.turnos_cancelados,
    )
    expect(resumen.medicos_detalle).toHaveLength(1)
    expect(resumen.medicos_detalle[0].nombre).toBe('Gómez, Juan')
  })

  it('calcula turnos por estado independientemente de pagos y asegura que turnos_totales sea la suma', () => {
    const data: AppData = {
      ...EMPTY_APP_DATA,
      doctors: [
        { id: 'doc1', apellido: 'Gómez', nombre: 'Juan', activo: true, porcentaje: 70 },
      ],
      // Varios turnos con diferentes estados (con y sin pago)
      appointments: [
        // 1. Atendido CON pago
        {
          id: 'app_atendido_pago',
          patientId: 'p1',
          doctorId: 'doc1',
          fechaHora: '2026-11-04T08:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'atendido',
        },
        // 2. Atendido SIN pago
        {
          id: 'app_atendido_sin_pago',
          patientId: 'p2',
          doctorId: 'doc1',
          fechaHora: '2026-11-04T09:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'atendido',
        },
        // 3. Programado CON pago
        {
          id: 'app_prog_pago',
          patientId: 'p3',
          doctorId: 'doc1',
          fechaHora: '2026-11-04T10:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'programado',
        },
        // 4. Programado SIN pago
        {
          id: 'app_prog_sin_pago',
          patientId: 'p4',
          doctorId: 'doc1',
          fechaHora: '2026-11-04T11:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'programado',
        },
        // 5. Presente (pendiente) SIN pago
        {
          id: 'app_presente',
          patientId: 'p5',
          doctorId: 'doc1',
          fechaHora: '2026-11-04T11:30:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'presente',
        },
        // 6. Cancelado CON pago previo o registrado
        {
          id: 'app_canc_pago',
          patientId: 'p6',
          doctorId: 'doc1',
          fechaHora: '2026-11-04T14:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'cancelado',
        },
        // 7. Cancelado SIN pago
        {
          id: 'app_canc_sin_pago',
          patientId: 'p7',
          doctorId: 'doc1',
          fechaHora: '2026-11-04T15:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'cancelado',
        },
        // Turno de OTRO día (no debe contarse)
        {
          id: 'app_otro_dia',
          patientId: 'p8',
          doctorId: 'doc1',
          fechaHora: '2026-11-05T09:00:00',
          duracionMinutos: 30,
          notas: '',
          estado: 'programado',
        },
      ],
      payments: [
        {
          id: 'pay1',
          patientId: 'p1',
          doctorId: 'doc1',
          citaId: 'app_atendido_pago',
          monto: 10000,
          fecha: '2026-11-04T08:30:00',
          metodo: 'Efectivo',
          notas: '',
        },
        {
          id: 'pay3',
          patientId: 'p3',
          doctorId: 'doc1',
          citaId: 'app_prog_pago',
          monto: 12000,
          fecha: '2026-11-04T09:50:00',
          metodo: 'Transferencia',
          notas: '',
        },
        {
          id: 'pay6',
          patientId: 'p6',
          doctorId: 'doc1',
          citaId: 'app_canc_pago',
          monto: 8000,
          fecha: '2026-11-04T13:50:00',
          metodo: 'Efectivo',
          notas: '',
        },
        // Pago sin cita vinculada (atención espontánea / cobro libre) -> NO debe alterar el conteo de citas de la agenda
        {
          id: 'pay_espontaneo',
          patientId: 'p99',
          doctorId: 'doc1',
          citaId: null,
          monto: 5000,
          fecha: '2026-11-04T16:00:00',
          metodo: 'Efectivo',
          notas: '',
        },
      ],
    }

    const resumen = calcularResumenDiario(data, '2026-11-04')

    // Atendidos = 2 (app_atendido_pago, app_atendido_sin_pago)
    expect(resumen.turnos_atendidos).toBe(2)

    // Pendientes = 3 (app_prog_pago, app_prog_sin_pago, app_presente)
    expect(resumen.turnos_pendientes).toBe(3)

    // Cancelados = 2 (app_canc_pago, app_canc_sin_pago)
    expect(resumen.turnos_cancelados).toBe(2)

    // Totales = Atendidos + Pendientes + Cancelados = 2 + 3 + 2 = 7
    expect(resumen.turnos_totales).toBe(7)
    expect(resumen.turnos_totales).toBe(
      resumen.turnos_atendidos + resumen.turnos_pendientes + resumen.turnos_cancelados,
    )
  })
  it("clasifica turnos en obra_social, plan_plus y particular cumpliendo los invariantes de suma", () => {
    const data: AppData = {
      ...EMPTY_APP_DATA,
      patients: [
        { id: "pac_os", nombre: "Ana", apellido: "Lopez", dni: "1", telefono: "", email: "", domicilio: "", localidad: "", fechaNacimiento: "", obraSocial: "OSDE", notas: "" },
        { id: "pac_plan", nombre: "Carlos", apellido: "Perez", dni: "2", telefono: "", email: "", domicilio: "", localidad: "", fechaNacimiento: "", obraSocial: "", notas: "" },
        { id: "pac_part", nombre: "Elena", apellido: "Rios", dni: "3", telefono: "", email: "", domicilio: "", localidad: "", fechaNacimiento: "", obraSocial: "Particular", notas: "" },
      ],
      planesAfiliados: [
        { id: "plan1", nombre: "Plan Plus", precio: 0, cupoConsultas: 0, activo: true, descripcion: "" },
      ],
      afiliados: [
        { id: "afil1", patientId: "pac_plan", planId: "plan1", fechaInicio: "2026-01-01", activo: true },
      ],
      appointments: [
        // ATENDIDOS: 1 obra social, 1 plan plus, 1 particular
        { id: "a1", patientId: "pac_os", doctorId: "d1", fechaHora: "2026-11-04T10:00:00", duracionMinutos: 30, notas: "", estado: "atendido" },
        { id: "a2", patientId: "pac_plan", doctorId: "d1", fechaHora: "2026-11-04T10:30:00", duracionMinutos: 30, notas: "", estado: "atendido" },
        { id: "a3", patientId: "pac_part", doctorId: "d1", fechaHora: "2026-11-04T11:00:00", duracionMinutos: 30, notas: "", estado: "atendido" },

        // PENDIENTES: 2 obra social, 1 plan plus con override, 1 particular
        { id: "a4", patientId: "pac_os", doctorId: "d1", fechaHora: "2026-11-04T15:00:00", duracionMinutos: 30, notas: "", estado: "programado" },
        { id: "a5", patientId: "pac_os", doctorId: "d1", fechaHora: "2026-11-04T15:30:00", duracionMinutos: 30, notas: "", estado: "programado" },
        { id: "a6", patientId: "pac_part", doctorId: "d1", fechaHora: "2026-11-04T16:00:00", duracionMinutos: 30, notas: "", estado: "programado", obraSocialOverride: "Plan Plus" },
        { id: "a7", patientId: "pac_part", doctorId: "d1", fechaHora: "2026-11-04T16:30:00", duracionMinutos: 30, notas: "", estado: "programado" },

        // CANCELADOS: 1 obra social, 1 particular (pac_os con override Particular)
        { id: "a8", patientId: "pac_os", doctorId: "d1", fechaHora: "2026-11-04T18:00:00", duracionMinutos: 30, notas: "", estado: "cancelado" },
        { id: "a9", patientId: "pac_os", doctorId: "d1", fechaHora: "2026-11-04T18:30:00", duracionMinutos: 30, notas: "", estado: "cancelado", obraSocialOverride: "Particular" },
      ],
    }

    const resumen = calcularResumenDiario(data, "2026-11-04")
    const { atendidos, pendientes, cancelados } = resumen.turnos_clasificacion

    // Atendidos = 3 (1 OS, 1 Plan, 1 Part)
    expect(resumen.turnos_atendidos).toBe(3)
    expect(atendidos.obra_social).toBe(1)
    expect(atendidos.plan_plus).toBe(1)
    expect(atendidos.particular).toBe(1)
    expect(atendidos.obra_social + atendidos.plan_plus + atendidos.particular).toBe(resumen.turnos_atendidos)

    // Pendientes = 4 (2 OS, 1 Plan, 1 Part)
    expect(resumen.turnos_pendientes).toBe(4)
    expect(pendientes.obra_social).toBe(2)
    expect(pendientes.plan_plus).toBe(1)
    expect(pendientes.particular).toBe(1)
    expect(pendientes.obra_social + pendientes.plan_plus + pendientes.particular).toBe(resumen.turnos_pendientes)

    // Cancelados = 2 (1 OS, 0 Plan, 1 Part)
    expect(resumen.turnos_cancelados).toBe(2)
    expect(cancelados.obra_social).toBe(1)
    expect(cancelados.plan_plus).toBe(0)
    expect(cancelados.particular).toBe(1)
    expect(cancelados.obra_social + cancelados.plan_plus + cancelados.particular).toBe(resumen.turnos_cancelados)

    // Totales = Atendidos + Pendientes + Cancelados = 9
    expect(resumen.turnos_totales).toBe(9)
    expect(resumen.turnos_totales).toBe(
      resumen.turnos_atendidos + resumen.turnos_pendientes + resumen.turnos_cancelados,
    )
  })

  it('incluye en resumen de turnos y médicos los turnos que no pagaron plus ni abonos (titulares, adherentes y obra social)', () => {
    const data: AppData = {
      ...EMPTY_APP_DATA,
      doctors: [
        { id: 'doc1', apellido: 'Aguirre', nombre: 'Rafael', activo: true, porcentaje: 16, especialidad: 'Diabetología', dni: '', matricula: '', telefono: '', localidad: '', email: '' },
      ],
      patients: [
        { id: 'p_titular', nombre: 'Luis', apellido: 'Sawallisch', dni: '62', telefono: '', email: '', domicilio: '', localidad: '', fechaNacimiento: '', obraSocial: 'IPS', notas: '' },
        { id: 'p_adherente', nombre: 'Maria', apellido: 'Acosta', dni: '63', telefono: '', email: '', domicilio: '', localidad: '', fechaNacimiento: '', obraSocial: 'Familiar', notas: '' },
        { id: 'p_os_sin_plus', nombre: 'Jorge', apellido: 'Gimenez', dni: '64', telefono: '', email: '', domicilio: '', localidad: '', fechaNacimiento: '', obraSocial: 'IPS', notas: '' },
      ],
      planesAfiliados: [
        { id: 'plan_fam', nombre: 'Familiar', precio: 70000, cupoConsultas: 3, activo: true, descripcion: '' },
      ],
      afiliados: [
        {
          id: 'af1',
          patientId: 'p_titular',
          planId: 'plan_fam',
          fechaInicio: '2026-11-01',
          activo: true,
          adherentes: [
            { id: 'adh1', patientId: 'p_adherente', nombre: 'Maria', apellido: 'Acosta', dni: '63', fechaNacimiento: '', relacion: 'Conyuge' },
          ],
        },
      ],
      appointments: [
        { id: 't1', patientId: 'p_titular', doctorId: 'doc1', fechaHora: '2026-11-13T11:30:00', duracionMinutos: 30, notas: '', estado: 'programado', obraSocialOverride: 'Familiar' },
        { id: 't2', patientId: 'p_adherente', doctorId: 'doc1', fechaHora: '2026-11-13T12:00:00', duracionMinutos: 30, notas: '', estado: 'programado' },
        { id: 't3', patientId: 'p_os_sin_plus', doctorId: 'doc1', fechaHora: '2026-11-13T12:30:00', duracionMinutos: 30, notas: '', estado: 'programado' },
      ],
      payments: [],
    }

    const resumen = calcularResumenDiario(data, '2026-11-13')

    expect(resumen.total_cobrado).toBe(0)
    expect(resumen.turnos_totales).toBe(3)
    expect(resumen.turnos_pendientes).toBe(3)
    expect(resumen.turnos_clasificacion.pendientes.plan_plus).toBe(2)
    expect(resumen.turnos_clasificacion.pendientes.obra_social).toBe(1)
    expect(resumen.medicos_detalle).toHaveLength(1)
    expect(resumen.medicos_detalle[0].nombre).toBe('Aguirre, Rafael')
    expect(resumen.medicos_detalle[0].pacientes).toBe(3)
    expect(resumen.medicos_detalle[0].totalCobrado).toBe(0)
  })
})

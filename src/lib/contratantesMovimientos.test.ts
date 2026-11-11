import { describe, expect, it } from 'vitest'
import type { Afiliado, CuotaMensual, Patient, PlanAfiliado } from '../types'
import { contextoCoberturaDe } from './cobertura'
import {
  cancelarCambioProgramadoState,
  darDeBajaContratanteState,
  ejecutarCambioCoberturaEfectivo,
  esContratanteDadoDeBaja,
  esContratanteSuspendido,
  obtenerMovimientosContratante,
  procesarTareasDiariasContratantes,
  programarCambioCoberturaState,
  reactivarContratanteState,
  suspenderContratanteState,
} from './contratantesMovimientos'

const planesBase: PlanAfiliado[] = [
  {
    id: 'plan-ind',
    nombre: 'Plan Individual',
    tipo: 'individual',
    precio: 35000,
    descripcion: '',
    cupoConsultas: 2,
    prestacionesPorMes: 2,
    activo: true,
  },
  {
    id: 'plan-fam',
    nombre: 'Plan Familiar',
    tipo: 'familiar',
    precio: 70000,
    descripcion: '',
    cupoConsultas: 3,
    prestacionesPorMes: 3,
    maxAdherentes: 4,
    activo: true,
  },
]

function crearPaciente(partial: Partial<Patient> & { id: string; nombre: string; apellido: string; dni: string }): Patient {
  return {
    fechaNacimiento: '1985-05-10',
    telefono: '',
    email: '',
    domicilio: '',
    localidad: '',
    obraSocial: '',
    notas: '',
    activo: true,
    ...partial,
  }
}

describe('contratantesMovimientos', () => {
  it('cambia de Individual a Familiar desde hoy creando y reutilizando pacientes por DNI', () => {
    const titular = crearPaciente({
      id: 'p-tit',
      apellido: 'GOMEZ',
      nombre: 'JUAN',
      dni: '20111222',
      obraSocial: 'Plan Individual',
      obraSocialAnterior: 'IOSFA',
    })
    const conyugeExistente = crearPaciente({
      id: 'p-cony',
      apellido: 'PEREZ',
      nombre: 'MARIA',
      dni: '22333444',
      obraSocial: 'OSDE',
    })
    const afiliado: Afiliado = {
      id: 'af-1',
      patientId: 'p-tit',
      planId: 'plan-ind',
      fechaInicio: '2026-01-01',
      activo: true,
      obraSocialAnterior: 'IOSFA',
      historialCoberturas: [
        {
          planId: 'plan-ind',
          planNombre: 'Plan Individual',
          desde: '2026-01-01',
        },
      ],
    }

    const res = ejecutarCambioCoberturaEfectivo(
      {
        patients: [titular, conyugeExistente],
        afiliados: [afiliado],
        planesAfiliados: planesBase,
      },
      {
        afiliadoId: 'af-1',
        planNuevoId: 'plan-fam',
        fechaVigencia: '2026-11-10',
        nuevosAdherentes: [
          {
            dni: '22333444',
            apellido: 'PEREZ',
            nombre: 'MARIA',
            fechaNacimiento: '1987-02-10',
            relacion: 'Cónyuge',
          },
          {
            dni: '45999888',
            apellido: 'GOMEZ',
            nombre: 'LUCAS',
            fechaNacimiento: '2012-04-15',
            relacion: 'Hijo/a',
          },
        ],
        usuario: 'Laura',
      },
    )

    // No duplica a María (22333444), crea a Lucas (45999888)
    expect(res.patients).toHaveLength(3)
    expect(res.pacientesExistentesReutilizados).toHaveLength(1)
    expect(res.pacientesExistentesReutilizados[0]).toContain('22333444')

    const mariaActualizada = res.patients.find((p) => p.id === 'p-cony')!
    expect(mariaActualizada.obraSocial).toBe('Plan Familiar')
    expect(mariaActualizada.obraSocialAnterior).toBe('OSDE')

    const lucasCreado = res.patients.find((p) => p.dni === '45999888')!
    expect(lucasCreado).toBeDefined()
    expect(lucasCreado.obraSocial).toBe('Plan Familiar')

    const afilActualizado = res.afiliados.find((a) => a.id === 'af-1')!
    expect(afilActualizado.planId).toBe('plan-fam')
    expect(afilActualizado.adherentes).toHaveLength(2)
    expect(afilActualizado.historialCoberturas).toHaveLength(2)
    expect(afilActualizado.historialCoberturas?.[0]?.hasta).toBe('2026-11-10')
    expect(afilActualizado.historialCoberturas?.[1]?.planNombre).toBe('Plan Familiar')

    const pMap = new Map(res.patients.map((p) => [p.id, p]))
    const movs = obtenerMovimientosContratante(afilActualizado, planesBase, pMap)
    expect(movs[0]?.tipo).toBe('cambio_cobertura')
    expect(movs[0]?.usuario).toBe('Laura')
  })

  it('programa cambio de cobertura para el 1.º del mes siguiente, permite cancelarlo o aplicarlo el día indicado', () => {
    const titular = crearPaciente({
      id: 'p-tit',
      apellido: 'GOMEZ',
      nombre: 'JUAN',
      dni: '20111222',
      obraSocial: 'Plan Individual',
    })
    const afiliado: Afiliado = {
      id: 'af-1',
      patientId: 'p-tit',
      planId: 'plan-ind',
      fechaInicio: '2026-01-01',
      activo: true,
    }

    const programado = programarCambioCoberturaState(
      {
        patients: [titular],
        afiliados: [afiliado],
        planesAfiliados: planesBase,
      },
      {
        afiliadoId: 'af-1',
        planNuevoId: 'plan-fam',
        fechaVigencia: '2026-12-01',
        programado: true,
        nuevosAdherentes: [
          {
            dni: '40111222',
            apellido: 'GOMEZ',
            nombre: 'ANA',
            fechaNacimiento: '1990-01-01',
            relacion: 'Cónyuge',
          },
        ],
        usuario: 'Recepción',
      },
    )

    expect(programado.afiliados[0]?.planId).toBe('plan-ind')
    expect(programado.afiliados[0]?.cambioCoberturaProgramado?.planNuevoId).toBe('plan-fam')
    expect(programado.afiliados[0]?.cambioCoberturaProgramado?.fechaVigencia).toBe('2026-12-01')

    // Antes de la fecha no se aplica
    const antes = procesarTareasDiariasContratantes(
      {
        patients: programado.patients,
        afiliados: programado.afiliados,
        planesAfiliados: planesBase,
      },
      '2026-11-25',
    )
    expect(antes.changed).toBe(false)

    // El día 2026-12-01 se aplica automáticamente
    const elDia = procesarTareasDiariasContratantes(
      {
        patients: programado.patients,
        afiliados: programado.afiliados,
        planesAfiliados: planesBase,
      },
      '2026-12-01',
    )
    expect(elDia.changed).toBe(true)
    expect(elDia.afiliados[0]?.planId).toBe('plan-fam')
    expect(elDia.afiliados[0]?.cambioCoberturaProgramado).toBeUndefined()
    expect(elDia.patients).toHaveLength(2)

    // También se puede cancelar antes de que aplique
    const cancelado = cancelarCambioProgramadoState(programado.afiliados, 'af-1', 'Recepción')
    expect(cancelado[0]?.cambioCoberturaProgramado).toBeUndefined()
  })

  it('cambia de Familiar a Individual restaurando obra social anterior o pasándolos a Individual sin borrar pacientes', () => {
    const titular = crearPaciente({
      id: 'p-tit',
      apellido: 'GOMEZ',
      nombre: 'JUAN',
      dni: '20111222',
      obraSocial: 'Plan Familiar',
      obraSocialAnterior: 'OSDE',
    })
    const adh1 = crearPaciente({
      id: 'p-adh1',
      apellido: 'PEREZ',
      nombre: 'MARIA',
      dni: '22333444',
      obraSocial: 'Plan Familiar',
      obraSocialAnterior: 'SWISS MEDICAL',
    })
    const afilFam: Afiliado = {
      id: 'af-fam',
      patientId: 'p-tit',
      planId: 'plan-fam',
      fechaInicio: '2026-01-01',
      activo: true,
      obraSocialAnterior: 'OSDE',
      adherentes: [
        {
          patientId: 'p-adh1',
          relacion: 'Cónyuge',
          obraSocialAnterior: 'SWISS MEDICAL',
        },
      ],
    }

    // Caso (a): Quedan sin cobertura -> restaura obraSocialAnterior
    const resSinCob = ejecutarCambioCoberturaEfectivo(
      {
        patients: [titular, adh1],
        afiliados: [afilFam],
        planesAfiliados: planesBase,
      },
      {
        afiliadoId: 'af-fam',
        planNuevoId: 'plan-ind',
        fechaVigencia: '2026-11-10',
        opcionAdherentes: 'sin_cobertura',
        usuario: 'Recepción',
      },
    )
    expect(resSinCob.patients).toHaveLength(2)
    expect(resSinCob.patients.find((p) => p.id === 'p-tit')?.obraSocial).toBe('Plan Individual')
    expect(resSinCob.patients.find((p) => p.id === 'p-adh1')?.obraSocial).toBe('SWISS MEDICAL')
    expect(resSinCob.afiliados).toHaveLength(1)
    expect(resSinCob.afiliados[0]?.adherentes).toBeUndefined()

    // Caso (b): Pasan a Individual -> cada adherente pasa a ser contratante Individual
    const resPasanInd = ejecutarCambioCoberturaEfectivo(
      {
        patients: [titular, adh1],
        afiliados: [afilFam],
        planesAfiliados: planesBase,
      },
      {
        afiliadoId: 'af-fam',
        planNuevoId: 'plan-ind',
        fechaVigencia: '2026-11-10',
        opcionAdherentes: 'pasan_individual',
        usuario: 'Recepción',
      },
    )
    expect(resPasanInd.patients).toHaveLength(2)
    expect(resPasanInd.patients.find((p) => p.id === 'p-adh1')?.obraSocial).toBe('Plan Individual')
    expect(resPasanInd.afiliados).toHaveLength(2)
    const nuevoContratanteAdh = resPasanInd.afiliados.find((a) => a.patientId === 'p-adh1')
    expect(nuevoContratanteAdh).toBeDefined()
    expect(nuevoContratanteAdh?.planId).toBe('plan-ind')
    expect(nuevoContratanteAdh?.obraSocialAnterior).toBe('SWISS MEDICAL')
  })

  it('suspende y reactiva contratante (manual y automático por fecha Hasta) bloqueando cobertura en Turnos sin alterar deuda', () => {
    const titular = crearPaciente({
      id: 'p-tit',
      apellido: 'GOMEZ',
      nombre: 'JUAN',
      dni: '20111222',
      obraSocial: 'Plan Familiar',
    })
    const adh = crearPaciente({
      id: 'p-adh',
      apellido: 'GOMEZ',
      nombre: 'HIJO',
      dni: '48111222',
      obraSocial: 'Plan Familiar',
    })
    const afil: Afiliado = {
      id: 'af-1',
      patientId: 'p-tit',
      planId: 'plan-fam',
      fechaInicio: '2026-01-01',
      activo: true,
      adherentes: [{ patientId: 'p-adh', relacion: 'Hijo/a' }],
    }
    const cuotaImpaga: CuotaMensual = {
      id: 'c-1',
      afiliadoId: 'af-1',
      anio: 2026,
      mes: 10,
      monto: 70000,
      estado: 'pendiente',
      fechaPago: null,
      formaPago: null,
      comprobante: false,
      notas: '',
      usos: 0,
    }

    const suspendidos = suspenderContratanteState([afil], {
      afiliadoId: 'af-1',
      motivo: 'Viaje o ausencia',
      desde: '2026-11-01',
      hasta: '2026-11-15',
      observaciones: 'Viaje familiar',
      usuario: 'Recepción',
    })

    const afilSusp = suspendidos[0]!
    expect(esContratanteSuspendido(afilSusp, '2026-11-10')).toBe(true)

    // Turnos para titular y adherente avisan "Contratante suspendido"
    const cobTitular = contextoCoberturaDe(
      titular,
      suspendidos,
      planesBase,
      [cuotaImpaga],
      new Date('2026-11-10T10:00:00'),
    )
    expect(cobTitular.planHabilitado).toBe(false)
    expect(cobTitular.planMotivo).toBe('Contratante suspendido')

    const cobAdh = contextoCoberturaDe(
      adh,
      suspendidos,
      planesBase,
      [cuotaImpaga],
      new Date('2026-11-10T10:00:00'),
    )
    expect(cobAdh.planHabilitado).toBe(false)
    expect(cobAdh.planMotivo).toBe('Contratante suspendido')

    // Al llegar la fecha "hasta" (2026-11-15) se reactiva solo
    const autoReactivado = procesarTareasDiariasContratantes(
      {
        patients: [titular, adh],
        afiliados: suspendidos,
        planesAfiliados: planesBase,
      },
      '2026-11-15',
    )
    expect(autoReactivado.changed).toBe(true)
    expect(esContratanteSuspendido(autoReactivado.afiliados[0]!, '2026-11-15')).toBe(false)

    // Y manual también funciona y conserva deuda intacta
    const reactivadoManual = reactivarContratanteState(suspendidos, {
      afiliadoId: 'af-1',
      fecha: '2026-11-12',
      usuario: 'Recepción',
    })
    expect(esContratanteSuspendido(reactivadoManual[0]!, '2026-11-12')).toBe(false)
    const cobDespues = contextoCoberturaDe(
      titular,
      reactivadoManual,
      planesBase,
      [cuotaImpaga],
      new Date('2026-11-12T10:00:00'),
    )
    expect(cobDespues.planHabilitado).toBe(false)
    expect(cobDespues.planMotivo).toContain('cuotas impagas') // Sigue siendo deudor porque su deuda no se tocó
  })

  it('da de baja al contratante restaurando obra social anterior en titular y adherentes y conservando historial', () => {
    const titular = crearPaciente({
      id: 'p-tit',
      apellido: 'GOMEZ',
      nombre: 'JUAN',
      dni: '20111222',
      obraSocial: 'Plan Familiar',
      obraSocialAnterior: 'PAMI',
    })
    const adh = crearPaciente({
      id: 'p-adh',
      apellido: 'GOMEZ',
      nombre: 'ANA',
      dni: '48111222',
      obraSocial: 'Plan Familiar',
      obraSocialAnterior: '',
    })
    const afil: Afiliado = {
      id: 'af-1',
      patientId: 'p-tit',
      planId: 'plan-fam',
      fechaInicio: '2026-01-01',
      activo: true,
      obraSocialAnterior: 'PAMI',
      adherentes: [{ patientId: 'p-adh', relacion: 'Hijo/a', obraSocialAnterior: '' }],
    }

    const res = darDeBajaContratanteState(
      {
        patients: [titular, adh],
        afiliados: [afil],
        planesAfiliados: planesBase,
      },
      {
        afiliadoId: 'af-1',
        motivo: 'A pedido del contratante',
        fechaBaja: '2026-11-09',
        usuario: 'Recepción',
      },
    )

    const afilBaja = res.afiliados[0]!
    expect(esContratanteDadoDeBaja(afilBaja, '2026-11-09')).toBe(true)
    expect(res.patients.find((p) => p.id === 'p-tit')?.obraSocial).toBe('PAMI')
    expect(res.patients.find((p) => p.id === 'p-adh')?.obraSocial).toBe('')
    expect(afilBaja.movimientos?.[0]?.tipo).toBe('baja')
    expect(afilBaja.movimientos?.[0]?.motivo).toBe('A pedido del contratante')
  })
})

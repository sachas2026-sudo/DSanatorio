import { describe, expect, it } from 'vitest'
import {
  buildDistribucionFilas,
  consolidarPorMedico,
  esCoberturaParticular,
  repartoDeFila,
  textoFechaColumna,
  textoPeriodoMedico,
  type DistribucionFila,
} from './distribucionObrasSocialesFilas'
import type { Appointment, Doctor, Patient, Payment } from '../types'

const SIN_PORCENTAJE = () => 0

function detalleDe(
  filas: {
    id: string
    nombre: string
    especialidad?: string
    paciente: string
    motivo: string
    monto: number
    arancel?: number
    fecha?: string
    obras?: string[]
  }[],
): DistribucionFila[] {
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    especialidad: f.especialidad ?? '—',
    fecha: f.fecha ?? '2026-05-04',
    paciente: f.paciente,
    mostrarPaciente: true,
    motivo: f.motivo,
    monto: f.monto,
    // Sin arancel explícito, la base del % es el monto (como antes).
    arancel: f.arancel ?? f.monto,
    impBanco: 0,
    impFactura: 0,
    gastosAdm: 0,
    totalCuidar: 0,
    total: 0,
    obras: new Set(f.obras ?? []),
    cantidadPagos: 1,
  }))
}

describe('esCoberturaParticular', () => {
  it('detecta Particular sin importar mayúsculas ni espacios', () => {
    expect(esCoberturaParticular('Particular')).toBe(true)
    expect(esCoberturaParticular('  particular  ')).toBe(true)
    expect(esCoberturaParticular('PARTICULAR')).toBe(true)
  })

  it('una cobertura vacía también es particular', () => {
    expect(esCoberturaParticular('')).toBe(true)
    expect(esCoberturaParticular('   ')).toBe(true)
  })

  it('una obra social real no es particular', () => {
    expect(esCoberturaParticular('ASIS SALUD')).toBe(false)
    expect(esCoberturaParticular('Plan Plus')).toBe(false)
  })
})

describe('buildDistribucionFilas: sólo pagos con obra social', () => {
  const base = {
    doctorById: (id: string) => ({ id, nombre: 'Rafael', apellido: 'Aguirre', especialidad: 'Diabetología' }) as Doctor,
    patientById: (id: string) => ({ id, nombre: 'Juan', apellido: 'Aguilar' }) as Patient,
    citaById: () => undefined,
    motivosDe: () => ['Consulta'],
  }

  function pago(id: string, monto: number): Payment {
    return {
      id,
      doctorId: 'd1',
      patientId: 'p1',
      citaId: null,
      monto,
      fecha: '2026-05-04',
      metodo: 'Efectivo',
      notas: '',
    } as Payment
  }

  it('saca el pago cuando la cobertura es Particular', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pago('a', 100000), pago('b', 50000)],
      obraSocialDe: (p) => (p.id === 'b' ? 'Particular' : 'ASIS SALUD'),
    })
    expect(filas).toHaveLength(1)
    expect(filas[0]!.monto).toBe(100000)
  })

  it('saca el pago cuando la cobertura viene vacía', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pago('a', 100000), pago('b', 50000)],
      obraSocialDe: (p) => (p.id === 'b' ? '' : 'ASIS SALUD'),
    })
    expect(filas).toHaveLength(1)
    expect(filas[0]!.monto).toBe(100000)
  })

  it('deja todos los pagos con obra social y suma el total de los que quedan', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pago('a', 100000), pago('b', 60000), pago('c', 40000)],
      obraSocialDe: () => 'ASIS SALUD',
    })
    expect(filas.reduce((s, f) => s + f.monto, 0)).toBe(200000)
  })

  it('si todos los pagos son particular, la tabla queda vacía', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pago('a', 100000)],
      obraSocialDe: () => 'Particular',
    })
    expect(filas).toEqual([])
  })

  it('la obra social que se guarda es la cobertura efectiva', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pago('a', 100000)],
      obraSocialDe: () => '  MELD SALUD  ',
    })
    expect([...filas[0]!.obras]).toEqual(['MELD SALUD'])
  })
})

describe('textoFechaColumna', () => {
  it('una fecha: dd-MM-aa', () => {
    expect(textoFechaColumna('2026-05-04')).toBe('04-05-26')
  })

  it('acepta un ISO con hora', () => {
    expect(textoFechaColumna('2026-05-04T10:00:00.000Z')).toBe('04-05-26')
  })

  it('fecha vacía o inválida devuelve vacío', () => {
    expect(textoFechaColumna('')).toBe('')
    expect(textoFechaColumna('no-es-fecha')).toBe('')
  })
})

describe('textoPeriodoMedico', () => {
  it('una sola fecha: la misma fecha', () => {
    expect(textoPeriodoMedico('2026-05-04', '2026-05-04')).toBe('04-05-26')
  })

  it('varias fechas: el rango completo', () => {
    expect(textoPeriodoMedico('2026-05-01', '2026-05-31')).toBe('01-05-26 - 31-05-26')
  })
})

describe('fecha del turno de la agenda', () => {
  const citas = [
    { id: 'c1', fechaHora: '2026-05-11T14:00:00.000Z' },
    { id: 'c2', fechaHora: '2026-05-22T09:00:00.000Z' },
  ] as Appointment[]

  function pagoConCita(id: string, citaId: string | null, monto: number, fechaPago: string): Payment {
    return {
      id,
      citaId,
      doctorId: 'd1',
      patientId: 'p1',
      monto,
      fecha: fechaPago,
      metodo: 'Efectivo',
      notas: '',
    } as Payment
  }

  const base = {
    doctorById: () => undefined,
    patientById: () => undefined,
    obraSocialDe: () => 'OS1',
    motivosDe: () => ['Consulta'],
    citaById: (id: string) => citas.find((c) => c.id === id),
  }

  it('usa la fecha del turno, no la del pago', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pagoConCita('a', 'c1', 1000, '2026-06-30T10:00:00.000Z')],
    })
    expect(filas[0]!.fecha).toBe('2026-05-11')
  })

  it('si el pago no tiene turno, cae a la fecha del pago', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pagoConCita('a', null, 1000, '2026-06-30T10:00:00.000Z')],
    })
    expect(filas[0]!.fecha).toBe('2026-06-30')
  })

  it('si la cita no existe en la base, cae a la fecha del pago', () => {
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [pagoConCita('a', 'no-esta', 1000, '2026-06-30T10:00:00.000Z')],
    })
    expect(filas[0]!.fecha).toBe('2026-06-30')
  })
})

describe('consolidarPorMedico', () => {
  it('médico con una sola fila: la consolidada es idéntica', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'Aguirre, Rafael', especialidad: 'Diabetología', paciente: 'Aguilar, Juan', motivo: 'Consulta', monto: 250000 },
    ])
    const [fila] = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    expect(fila).toMatchObject({
      nombre: 'Aguirre, Rafael',
      especialidad: 'Diabetología',
      paciente: 'Aguilar, Juan',
      motivo: 'Consulta',
      monto: 250000,
      cantidadMotivos: 1,
    })
  })

  it('tres filas y pacientes distintos → "Varios", "Consulta +2" y 455000', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'Caballero, Yolanda', especialidad: 'Cardiología', paciente: 'Varios', motivo: 'Consulta', monto: 335000 },
      { id: 'd1', nombre: 'Caballero, Yolanda', especialidad: 'Cardiología', paciente: 'Solaeche, Juan Jose', motivo: 'Electrocardiograma', monto: 60000 },
      { id: 'd1', nombre: 'Caballero, Yolanda', especialidad: 'Cardiología', paciente: 'Catania, Nidia Alejandra', motivo: 'Presurometría', monto: 60000 },
    ])
    const [fila] = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    expect(fila!.paciente).toBe('Varios')
    expect(fila!.motivo).toBe('Consulta +2')
    expect(fila!.monto).toBe(455000)
    expect(fila!.cantidadMotivos).toBe(3)
    // El tooltip lista todos los motivos con su monto, de mayor a menor.
    expect(fila!.motivosDetalle).toEqual([
      { motivo: 'Consulta', monto: 335000 },
      { motivo: 'Electrocardiograma', monto: 60000 },
      { motivo: 'Presurometría', monto: 60000 },
    ])
  })

  it('filas del mismo paciente: muestra el nombre del paciente', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'Velazquez, Roberto', especialidad: 'Clínica médica', paciente: 'Gomez, Sofia', motivo: 'Consulta', monto: 150000 },
      { id: 'd1', nombre: 'Velazquez, Roberto', especialidad: 'Clínica médica', paciente: 'Gomez, Sofia', motivo: 'Ecografía', monto: 55000 },
    ])
    const [fila] = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    expect(fila!.paciente).toBe('Gomez, Sofia')
    expect(fila!.motivo).toBe('Consulta +1')
    expect(fila!.monto).toBe(205000)
  })

  it('el motivo principal es el de mayor monto, no el primero', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'A', paciente: 'P', motivo: 'Ecografía', monto: 55000 },
      { id: 'd1', nombre: 'A', paciente: 'P', motivo: 'Consulta', monto: 150000 },
    ])
    const [fila] = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    expect(fila!.motivo).toBe('Consulta +1')
  })

  it('una fila sin monto cuenta 0 y no rompe la consolidación', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'Bustamante, Jazmin', especialidad: 'Psicología', paciente: 'P1', motivo: 'Consulta', monto: 105000 },
      { id: 'd2', nombre: 'Acosta, Arnaldo', especialidad: 'Ecografía', paciente: 'P2', motivo: 'Ecografía', monto: 0 },
    ])
    const filas = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    expect(filas).toHaveLength(2)
    const acosta = filas.find((f) => f.id === 'd2')!
    expect(acosta.monto).toBe(0)
    expect(acosta.total).toBe(0)
    expect(acosta.motivo).toBe('Ecografía')
  })

  it('toma la especialidad que existe cuando alguna fila no la tiene', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'A', especialidad: '—', paciente: 'P', motivo: 'Consulta', monto: 1000 },
      { id: 'd1', nombre: 'A', especialidad: 'Oftalmología', paciente: 'P', motivo: 'Control', monto: 2000 },
    ])
    const [fila] = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    expect(fila!.especialidad).toBe('Oftalmología')
  })

  it('reparte por obra social fila por fila y después suma', () => {
    // 100.000 y 60.000 al 33% → 33.000 + 19.800 = 52.800.
    // Si multiplicara el total (160.000) por 33% daría 52.800 también, así que
    // se usa un porcentaje que sí diferencia: 33,33% con filas impares.
    const pct = () => 33.33
    const detalle = detalleDe([
      { id: 'd1', nombre: 'A', paciente: 'P', motivo: 'Consulta', monto: 100000, obras: ['OS1'] },
      { id: 'd1', nombre: 'A', paciente: 'P', motivo: 'Control', monto: 60000, obras: ['OS1'] },
    ])
    const [fila] = consolidarPorMedico(detalle, pct)
    const porFila = detalle.map((f) => repartoDeFila(f.arancel, f.obras, pct, 'OS1'))
    expect(porFila[0] + porFila[1]).toBeCloseTo(fila!.porObraSocial.get('OS1')!, 10)
    expect(fila!.repartido).toBeCloseTo(porFila[0] + porFila[1], 10)
    expect(fila!.total).toBeCloseTo(160000 - fila!.repartido, 10)
  })

  it('RESUMEN: guarda el período y muestra la fecha más reciente', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'A', paciente: 'P', motivo: 'Consulta', monto: 100000, fecha: '2026-05-10' },
      { id: 'd1', nombre: 'A', paciente: 'P', motivo: 'Control', monto: 50000, fecha: '2026-05-20' },
      { id: 'd2', nombre: 'B', paciente: 'Q', motivo: 'Consulta', monto: 10000, fecha: '2026-05-02' },
    ])
    const filas = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    const a = filas.find((f) => f.id === 'd1')!
    expect(a.fechaDesde).toBe('2026-05-10')
    expect(a.fechaHasta).toBe('2026-05-20')
    // La columna muestra una sola fecha: la del turno más reciente.
    expect(textoFechaColumna(a.fecha)).toBe('20-05-26')
    expect(textoPeriodoMedico(a.fechaDesde, a.fechaHasta)).toBe('10-05-26 - 20-05-26')
    // Un médico con una sola fila muestra esa fecha.
    expect(textoFechaColumna(filas[1]!.fecha)).toBe('02-05-26')
  })

  it('sin detalle devuelve una lista vacía', () => {
    expect(consolidarPorMedico([], SIN_PORCENTAJE)).toEqual([])
  })
})

describe('invariante de totales entre RESUMEN y COMPLETO', () => {
  const TOTAL_ESPERADO = 3447000

  /**
   * Fixture con la forma real de la pantalla: 15 médicos y 19 filas de detalle
   * (CABALLERO con 3 motivos, BUSTAMANTE y VELAZQUEZ con 2), que es el "19
   * motivos" del pie. Suma 3.447.000 en las dos vistas.
   */
  const detalle: DistribucionFila[] = ([
    { id: 'm01', nombre: 'Aguirre, Rafael', especialidad: 'Diabetología', paciente: 'P1', mostrarPaciente: true, motivo: 'Consulta', monto: 250000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm02', nombre: 'Bustamante, Jazmin Belen', especialidad: 'Psicología', paciente: 'P2', mostrarPaciente: true, motivo: 'Consulta', monto: 105000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm02', nombre: 'Bustamante, Jazmin Belen', especialidad: 'Psicología', paciente: 'Acosta, Arnaldo', mostrarPaciente: true, motivo: 'Ecografía', monto: 0, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm03', nombre: 'Caballero, Yolanda', especialidad: 'Cardiología', paciente: 'P3', mostrarPaciente: true, motivo: 'Consulta', monto: 335000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm03', nombre: 'Caballero, Yolanda', especialidad: 'Cardiología', paciente: 'Solaeche, Juan Jose', mostrarPaciente: true, motivo: 'Electrocardiograma', monto: 60000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm03', nombre: 'Caballero, Yolanda', especialidad: 'Cardiología', paciente: 'Catania, Nidia Alejandra', mostrarPaciente: true, motivo: 'Presurometría', monto: 60000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm04', nombre: 'Castanares, Valeria', especialidad: 'Ginecología', paciente: 'P4', mostrarPaciente: true, motivo: 'Consulta', monto: 200000, obras: new Set(['OS2']), cantidadPagos: 1 },
    { id: 'm05', nombre: 'Dibiasi, Miguel Angel', especialidad: 'Pediatría', paciente: 'P5', mostrarPaciente: true, motivo: 'Consulta', monto: 270000, obras: new Set(['OS3']), cantidadPagos: 1 },
    { id: 'm06', nombre: 'Giudici, Silvana', especialidad: 'Neurología', paciente: 'P6', mostrarPaciente: true, motivo: 'Consulta', monto: 180000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm07', nombre: 'Imbach, Guillermo', especialidad: 'Gastroenterología', paciente: 'P7', mostrarPaciente: true, motivo: 'Consulta', monto: 300000, obras: new Set(['OS2']), cantidadPagos: 1 },
    { id: 'm08', nombre: 'Muyal, Joel Ernesto', especialidad: 'Traumatología', paciente: 'P8', mostrarPaciente: true, motivo: 'Consulta', monto: 130000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm09', nombre: 'Ocampo, Silvana', especialidad: 'Psicología', paciente: 'P9', mostrarPaciente: true, motivo: 'Consulta', monto: 30000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm10', nombre: 'Raviolo, Cecilia', especialidad: 'Nutricionista', paciente: 'P10', mostrarPaciente: true, motivo: 'Consulta', monto: 225000, obras: new Set(['OS2']), cantidadPagos: 1 },
    { id: 'm11', nombre: 'Schimpf, Roald Arturo', especialidad: 'Oftalmología', paciente: 'P11', mostrarPaciente: true, motivo: 'Consulta', monto: 762000, obras: new Set(['OS2']), cantidadPagos: 1 },
    { id: 'm12', nombre: 'Senestraki, Maria Fernanda', especialidad: 'Clínica médica', paciente: 'P12', mostrarPaciente: true, motivo: 'Consulta', monto: 210000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm13', nombre: 'Velazquez, Roberto', especialidad: 'Clínica médica', paciente: 'P13', mostrarPaciente: true, motivo: 'Consulta', monto: 150000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm13', nombre: 'Velazquez, Roberto', especialidad: 'Clínica médica', paciente: 'P14', mostrarPaciente: true, motivo: 'Ecografía', monto: 55000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm14', nombre: 'Venezuelo, Evelin', especialidad: 'Psicopedagogía', paciente: 'P15', mostrarPaciente: true, motivo: 'Consulta', monto: 75000, obras: new Set(['OS1']), cantidadPagos: 1 },
    { id: 'm15', nombre: 'Vidondo, Matias', especialidad: 'Otorrinolaringología', paciente: 'P16', mostrarPaciente: true, motivo: 'Consulta', monto: 50000, obras: new Set(['OS1']), cantidadPagos: 1 },
  ] as Omit<DistribucionFila, 'arancel' | 'impBanco' | 'impFactura' | 'gastosAdm' | 'totalCuidar' | 'total'>[]).map((f) => ({
    ...f,
    arancel: f.monto,
    impBanco: 0,
    impFactura: 0,
    gastosAdm: 0,
    totalCuidar: 0,
    total: 0,
  }))

  it('la suma del detalle es 3.447.000', () => {
    expect(detalle.reduce((s, f) => s + f.monto, 0)).toBe(TOTAL_ESPERADO)
  })

  it('la suma de las filas consolidadas es igual a la del detalle', () => {
    const pct = (os: string) => (os === 'OS1' ? 40 : os === 'OS2' ? 25 : 60)
    const resumen = consolidarPorMedico(detalle, pct)
    const sumaResumen = resumen.reduce((s, f) => s + f.monto, 0)
    const sumaDetalle = detalle.reduce((s, f) => s + f.monto, 0)
    expect(sumaResumen).toBe(sumaDetalle)
    expect(sumaResumen).toBe(TOTAL_ESPERADO)
  })

  it('el reparto por obra social también coincide entre las dos vistas', () => {
    const pct = (os: string) => (os === 'OS1' ? 40 : os === 'OS2' ? 25 : 60)
    const resumen = consolidarPorMedico(detalle, pct)
    const os = ['OS1', 'OS2', 'OS3']
    for (const o of os) {
      const desdeDetalle = detalle.reduce(
        (s, f) => s + repartoDeFila(f.monto, f.obras, pct, o),
        0,
      )
      const desdeResumen = resumen.reduce((s, f) => s + (f.porObraSocial.get(o) ?? 0), 0)
      expect(desdeResumen).toBeCloseTo(desdeDetalle, 10)
    }
  })

  it('el total médico (monto − reparto) también coincide', () => {
    const pct = (os: string) => (os === 'OS1' ? 40 : os === 'OS2' ? 25 : 60)
    const resumen = consolidarPorMedico(detalle, pct)
    const desdeResumen = resumen.reduce((s, f) => s + f.total, 0)
    const desdeDetalle = detalle.reduce((s, f) => {
      const repartido = [...f.obras].reduce((t, o) => t + repartoDeFila(f.arancel, f.obras, pct, o), 0)
      return s + (f.arancel - repartido)
    }, 0)
    expect(desdeResumen).toBeCloseTo(desdeDetalle, 10)
  })

  it('la cantidad de motivos del detalle se conserva (el contador del pie)', () => {
    // 19 filas de detalle → el pie dice "19 motivos" en las dos vistas.
    expect(detalle).toHaveLength(19)
    expect(consolidarPorMedico(detalle, SIN_PORCENTAJE)).toHaveLength(15)
  })

  it('RESUMEN: una fila por médico, sin desglose por motivo', () => {
    const filas = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    const caballero = filas.find((f) => f.nombre === 'Caballero, Yolanda')!
    expect(caballero.motivo).toBe('Consulta +2')
    expect(caballero.paciente).toBe('Varios')
    expect(caballero.monto).toBe(455000)
    expect(filas.filter((f) => f.nombre === 'Caballero, Yolanda')).toHaveLength(1)
  })

  it('RESUMEN: la fila de Bustamente junta su Consulta con la Ecografía sin monto', () => {
    const filas = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    const bustamante = filas.find((f) => f.nombre === 'Bustamante, Jazmin Belen')!
    expect(bustamante.monto).toBe(105000)
    expect(bustamante.paciente).toBe('Varios')
    expect(bustamante.motivo).toBe('Consulta +1')
    expect(bustamante.cantidadMotivos).toBe(2)
  })

  it('RESUMEN: un médico con una sola fila queda idéntico a COMPLETO', () => {
    const filas = consolidarPorMedico(detalle, SIN_PORCENTAJE)
    const filasDetalle = detalle.filter((f) => f.id === 'm09')
    expect(filasDetalle).toHaveLength(1)
    expect(filas.find((f) => f.id === 'm09')).toMatchObject({
      nombre: filasDetalle[0]!.nombre,
      especialidad: filasDetalle[0]!.especialidad,
      paciente: filasDetalle[0]!.paciente,
      motivo: filasDetalle[0]!.motivo,
      monto: filasDetalle[0]!.monto,
    })
  })
})

describe('buildDistribucionFilas (detalle)', () => {
  const doctores = [
    { id: 'd1', nombre: 'Rafael', apellido: 'Aguirre', especialidad: 'Diabetología' },
  ] as Doctor[]
  const pacientes = [
    { id: 'p1', nombre: 'Juan', apellido: 'Aguilar' },
  ] as Patient[]

  function pago(id: string, monto: number, motivos: string[], doctorId = 'd1'): Payment {
    return {
      id,
      doctorId,
      patientId: 'p1',
      citaId: null,
      monto,
      fecha: '2026-05-04T10:00:00.000Z',
      metodo: 'Efectivo',
      notas: '',
    } as Payment
  }

  const common = {
    doctorById: (id: string) => doctores.find((d) => d.id === id),
    patientById: (id: string) => pacientes.find((p) => p.id === id),
    obraSocialDe: () => 'OS1',
    motivosDe: (_p: Payment) => ['Consulta'],
  }

  it('un motivo "—" cae en "Sin motivo"', () => {
    const filas = buildDistribucionFilas({
      ...common,
      pagos: [pago('a', 1000, ['—'])],
      motivosDe: () => ['—'],
    })
    expect(filas[0]!.motivo).toBe('Sin motivo')
  })

  it('un pago con dos motivos da dos filas y el monto se cuenta una sola vez', () => {
    const filas = buildDistribucionFilas({
      ...common,
      pagos: [pago('a', 60000, ['Electrocardiograma', 'Consulta'])],
      motivosDe: () => ['Electrocardiograma', 'Consulta'],
    })
    expect(filas).toHaveLength(2)
    expect(filas.reduce((s, f) => s + f.monto, 0)).toBe(60000)
    // El importe queda en la fila de arriba una vez ordenadas.
    expect(filas[0]!.monto).toBe(60000)
    expect(filas[0]!.mostrarPaciente).toBe(true)
    expect(filas[1]!.monto).toBe(0)
    expect(filas[1]!.mostrarPaciente).toBe(false)
  })

  it('ordena por médico y, dentro de un médico, por motivo', () => {
    const dosDoctores = [
      { id: 'd1', nombre: 'Rafael', apellido: 'Zapata', especialidad: 'A' },
      { id: 'd2', nombre: 'Ana', apellido: 'Aguirre', especialidad: 'B' },
    ] as Doctor[]
    const base = {
      patientById: (id: string) => pacientes.find((p) => p.id === id),
      obraSocialDe: () => 'OS1',
      doctorById: (id: string) => dosDoctores.find((d) => d.id === id),
    }
    const porPago: Record<string, string> = { a: 'Ecografía', b: 'Control', c: 'Control' }
    const filas = buildDistribucionFilas({
      ...base,
      pagos: [
        pago('a', 10, ['Ecografía'], 'd1'),
        pago('b', 20, ['Control'], 'd2'),
        pago('c', 30, ['Control'], 'd1'),
      ],
      motivosDe: (p: Payment) => [porPago[p.id] ?? 'Consulta'],
    })
    // Aguirre antes que Zapata; dentro de Zapata, "Control" antes que "Ecografía".
    expect(filas.map((f) => f.nombre)).toEqual([
      'Aguirre, Ana',
      'Zapata, Rafael',
      'Zapata, Rafael',
    ])
    expect(filas.slice(1).map((f) => f.motivo)).toEqual(['Control', 'Ecografía'])
    expect(filas.map((f) => f.monto)).toEqual([20, 30, 10])
  })

  it('sin pagos devuelve una lista vacía', () => {
    expect(buildDistribucionFilas({ ...common, pagos: [] })).toEqual([])
  })
})
describe('el % se calcula sobre el Arancel', () => {
  it('repartoDeFila usa la base recibida (arancel), no el monto', () => {
    const detalle = detalleDe([
      { id: 'd1', nombre: 'A', paciente: 'P', motivo: 'Consulta', monto: 20000, arancel: 9000, obras: ['IPS'] },
    ])
    const pct = () => 30
    expect(repartoDeFila(detalle[0]!.arancel, detalle[0]!.obras, pct, 'IPS')).toBe(2700)
    const [fila] = consolidarPorMedico(detalle, pct)
    expect(fila!.porObraSocial.get('IPS')).toBe(2700)
    expect(fila!.arancel).toBe(9000)
    expect(fila!.total).toBe(9000 - 2700)
  })
})

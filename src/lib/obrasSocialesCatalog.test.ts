import { describe, it, expect } from 'vitest'
import {
  formatPesosAr,
  parsePesosAr,
  formatPorcentajeAr,
  parsePorcentajeAr,
  normalizeSearchText,
  buildObrasSocialesCatalog,
  MAX_MONTO_PESOS,
  MAX_CENTESIMAS,
} from './obrasSocialesCatalog'
import { OBRAS_SOCIALES } from './obrasSociales'

describe('obrasSocialesCatalog - Formato es-AR de Montos', () => {
  it('formatea montos con punto de miles en formato es-AR', () => {
    expect(formatPesosAr(0)).toBe('0')
    expect(formatPesosAr(20000)).toBe('20.000')
    expect(formatPesosAr(1500500)).toBe('1.500.500')
    expect(formatPesosAr(100_000_000)).toBe('100.000.000')
  })

  it('parsea montos eliminando no dígitos y aplicando tope de 100.000.000', () => {
    expect(parsePesosAr('20.000')).toBe(20000)
    expect(parsePesosAr('$ 20.000')).toBe(20000)
    expect(parsePesosAr('')).toBe(0)
    expect(parsePesosAr('999.999.999')).toBe(MAX_MONTO_PESOS)
  })
})

describe('obrasSocialesCatalog - Formato y Roundtrip de Porcentajes', () => {
  it('formatea centésimas con coma decimal es-AR', () => {
    expect(formatPorcentajeAr(0)).toBe('0')
    expect(formatPorcentajeAr(250)).toBe('2,5')
    expect(formatPorcentajeAr(330)).toBe('3,3')
    expect(formatPorcentajeAr(333)).toBe('3,33')
    expect(formatPorcentajeAr(1000)).toBe('10')
    expect(formatPorcentajeAr(10000)).toBe('100')
  })

  it('parsea porcentajes con coma o punto a centésimas enteras', () => {
    expect(parsePorcentajeAr('2,5')).toBe(250)
    expect(parsePorcentajeAr('2.5')).toBe(250)
    expect(parsePorcentajeAr('3,3')).toBe(330)
    expect(parsePorcentajeAr('3,33')).toBe(333)
    expect(parsePorcentajeAr('10')).toBe(1000)
    expect(parsePorcentajeAr('100')).toBe(10000)
  })

  it('aplica tope de 100% y rechaza negativos', () => {
    expect(parsePorcentajeAr('150')).toBe(MAX_CENTESIMAS)
    expect(parsePorcentajeAr('100,5')).toBe(MAX_CENTESIMAS)
    expect(parsePorcentajeAr('-5')).toBe(0)
  })

  it('roundtrip exacto porcentaje <-> centésimas', () => {
    const valores = [2.5, 3.3, 10, 25.5, 50, 100]
    for (const v of valores) {
      const centesimas = parsePorcentajeAr(v.toString().replace('.', ','))
      const formatted = formatPorcentajeAr(centesimas)
      const parsedAgain = parsePorcentajeAr(formatted)
      expect(parsedAgain).toBe(centesimas)
    }
  })
})

describe('obrasSocialesCatalog - Búsqueda sin tildes ni mayúsculas', () => {
  it('normaliza texto quitando tildes y pasando a minúsculas', () => {
    expect(normalizeSearchText('Médicus')).toBe('medicus')
    expect(normalizeSearchText('OSDE')).toBe('osde')
    expect(normalizeSearchText('CÓRDOBA')).toBe('cordoba')
  })

  it('filtra coincidencias ignorando acentos y mayúsculas', () => {
    const q = normalizeSearchText('med')
    const match = normalizeSearchText('Médicus').includes(q)
    expect(match).toBe(true)
  })
})

describe('obrasSocialesCatalog - Compatibilidad y Sembrado de Habituales', () => {
  it('siembra los 12 habituales por defecto con valores en 0 y versión 1', () => {
    const catalog = buildObrasSocialesCatalog([], [])
    expect(catalog.length).toBe(12)
    for (const h of OBRAS_SOCIALES) {
      const found = catalog.find((o) => o.nombre.toLowerCase() === h.toLowerCase())
      expect(found).toBeDefined()
      expect(found?.plus).toBe(0)
      expect(found?.arancel).toBe(0)
      expect(found?.cuidar).toBe(0)
      expect(found?.suspendida).toBe(false)
      expect(found?.version).toBe(1)
    }
  })

  it('convierte lista vieja de strings sin perder agregadas ni duplicar habituales', () => {
    const viejasCustom = ['OSDE', 'Prevensalud', 'ips', 'Federada']
    const catalog = buildObrasSocialesCatalog([], viejasCustom)

    // OSDE e IPS no se duplican (eran habituales)
    // Prevensalud y Federada se agregan con ceros y versión 1
    const nombres = catalog.map((o) => o.nombre.toLowerCase())
    expect(nombres.filter((n) => n === 'osde').length).toBe(1)
    expect(nombres.filter((n) => n === 'ips').length).toBe(1)

    const prevensalud = catalog.find((o) => o.nombre === 'Prevensalud')
    expect(prevensalud).toBeDefined()
    expect(prevensalud?.plus).toBe(0)
    expect(prevensalud?.version).toBe(1)

    const federada = catalog.find((o) => o.nombre === 'Federada')
    expect(federada).toBeDefined()

    // 12 habituales + 2 nuevas agregadas = 14
    expect(catalog.length).toBe(14)
  })

  it('preserva valores cargados previamente si existen', () => {
    const existente = [
      {
        nombre: 'OSDE',
        plus: 5000,
        arancel: 15000,
        cuidar: 2000,
        impBanco: 150,
        impFactura: 300,
        gastosAdm: 500,
        suspendida: false,
        version: 3,
      },
    ]
    const catalog = buildObrasSocialesCatalog(existente, [])
    const osde = catalog.find((o) => o.nombre === 'OSDE')
    expect(osde?.plus).toBe(5000)
    expect(osde?.arancel).toBe(15000)
    expect(osde?.cuidar).toBe(2000)
    expect(osde?.version).toBe(3)
  })

  it('agrega planes de Afiliados al catálogo respetando valores o sembrando ceros', () => {
    const planes = [
      { id: 'p1', nombre: 'Plan Individual', tipo: 'individual' },
      { id: 'p2', nombre: 'Plan Familiar', tipo: 'familiar' },
    ]
    const existentes = [
      {
        nombre: 'Plan Individual',
        plus: 1000,
        arancel: 18000,
        cuidar: 3000,
        impBanco: 250,
        impFactura: 330,
        gastosAdm: 500,
        suspendida: false,
        version: 2,
      },
    ]

    const catalog = buildObrasSocialesCatalog(existentes, [], planes)

    const individual = catalog.find((o) => o.nombre === 'Plan Individual')
    expect(individual).toBeDefined()
    expect(individual?.arancel).toBe(18000)
    expect(individual?.cuidar).toBe(3000)
    expect(individual?.version).toBe(2)

    const familiar = catalog.find((o) => o.nombre === 'Plan Familiar')
    expect(familiar).toBeDefined()
    expect(familiar?.arancel).toBe(0)
    expect(familiar?.plus).toBe(0)
    expect(familiar?.version).toBe(1)
  })
})


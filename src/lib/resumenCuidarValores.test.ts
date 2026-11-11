import { describe, it, expect } from 'vitest'
import {
  formatMontoCuidar,
  formatPorcentajeCuidar,
  buildTituloValoresConfigurados,
  buildValoresConfigurados,
  drawValoresConfiguradosBullets,
} from './resumenCuidarValores'
import jsPDF from 'jspdf'

describe('resumenCuidarValores', () => {
  describe('formatMontoCuidar', () => {
    it('formatea montos con símbolo $, espacio y separador de miles sin decimales', () => {
      expect(formatMontoCuidar(40000)).toBe('$ 40.000')
      expect(formatMontoCuidar(0)).toBe('$ 0')
      expect(formatMontoCuidar(1250000)).toBe('$ 1.250.000')
      expect(formatMontoCuidar(70000.4)).toBe('$ 70.000')
    })
  })

  describe('formatPorcentajeCuidar', () => {
    it('formatea porcentajes enteros con espacio antes del %', () => {
      expect(formatPorcentajeCuidar(30)).toBe('30 %')
      expect(formatPorcentajeCuidar(0)).toBe('0 %')
      expect(formatPorcentajeCuidar(100)).toBe('100 %')
    })

    it('formatea porcentajes con decimales usando coma decimal y espacio antes del %', () => {
      expect(formatPorcentajeCuidar(2.5)).toBe('2,5 %')
      expect(formatPorcentajeCuidar(15.75)).toBe('15,75 %')
    })
  })

  describe('buildTituloValoresConfigurados', () => {
    it('genera el título con apellido, nombre y especialidad', () => {
      const titulo = buildTituloValoresConfigurados({
        apellido: 'ALFONSO',
        nombre: 'CARMEN',
        especialidad: 'Endocrinología',
      })
      expect(titulo).toBe('ALFONSO, CARMEN (Endocrinología)')
    })

    it('genera el título sin paréntesis si no tiene especialidad', () => {
      const titulo = buildTituloValoresConfigurados({
        apellido: 'PEREZ',
        nombre: 'JUAN',
      })
      expect(titulo).toBe('PEREZ, JUAN')
    })
  })

  describe('buildValoresConfigurados', () => {
    it('particular con Cuidar fijo ($ 40.000 / $ 10.000 / médico $ 30.000)', () => {
      const lineas = buildValoresConfigurados({
        particular: 40000,
        cuidar: 10000,
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Consulta particular:')
      expect(lineas[0]?.texto).toBe(
        ' $ 40.000 - Cuidar $ 10.000 fijos y el Médico $ 30.000.',
      )
    })

    it('particular sin Cuidar (Cuidar es 0)', () => {
      const lineas = buildValoresConfigurados({
        particular: 40000,
        cuidar: 0,
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Consulta particular:')
      expect(lineas[0]?.texto).toBe(' $ 40.000.')
    })

    it('particular en 0 o no cargado se omite', () => {
      const lineasConCero = buildValoresConfigurados({
        particular: 0,
        cuidar: 10000,
      })
      expect(lineasConCero[0]?.texto).toBe('Sin valores configurados.')

      const lineasNull = buildValoresConfigurados({
        particular: null,
      })
      expect(lineasNull[0]?.texto).toBe('Sin valores configurados.')
    })

    it('Cuidar mayor que el particular: no calcular lo que recibe el médico (sin negativos)', () => {
      const lineas = buildValoresConfigurados({
        particular: 20000,
        cuidar: 30000,
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Consulta particular:')
      expect(lineas[0]?.texto).toBe(' $ 20.000 - Cuidar $ 30.000 fijos.')
      expect(lineas[0]?.texto).not.toContain('médico recibe')
    })

    it('obra social con % (30 %)', () => {
      const lineas = buildValoresConfigurados({
        obrasSociales: [{ nombre: 'PREVENCION SALUD', porcentaje: 30 }],
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Obra social PREVENCION SALUD:')
      expect(lineas[0]?.texto).toBe(' según arancel. Cuidar retiene el 30 %.')
    })

    it('obra social sin % (o 0 %)', () => {
      const lineas = buildValoresConfigurados({
        obrasSociales: [{ nombre: 'IPS', porcentaje: 0 }],
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Obra social IPS:')
      expect(lineas[0]?.texto).toBe(' según arancel.')
    })

    it('obra social con porcentaje con decimales (2,5 %)', () => {
      const lineas = buildValoresConfigurados({
        obrasSociales: [{ nombre: 'SWISS MEDICAL', porcentaje: 2.5 }],
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Obra social SWISS MEDICAL:')
      expect(lineas[0]?.texto).toBe(' según arancel. Cuidar retiene el 2,5 %.')
    })

    it('obra social con monto fijo', () => {
      const lineas = buildValoresConfigurados({
        obrasSociales: [{ nombre: 'OSDE', porcentaje: 0, monto: 5000 }],
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Obra social OSDE:')
      expect(lineas[0]?.texto).toBe(' según arancel. Cuidar retiene $ 5.000 fijos.')
    })

    it('monto diario cargado ($ 70.000) y no cargado (0 o null)', () => {
      const lineasCargado = buildValoresConfigurados({
        valor: 70000,
      })
      expect(lineasCargado).toHaveLength(1)
      expect(lineasCargado[0]?.etiqueta).toBe('Monto diario de Cuidar:')
      expect(lineasCargado[0]?.texto).toBe(' $ 70.000.')

      const lineasNoCargado = buildValoresConfigurados({
        valor: 0,
      })
      expect(lineasNoCargado[0]?.texto).toBe('Sin valores configurados.')
    })

    it('respeta el orden: monto diario, consulta particular, varias obras sociales', () => {
      const lineas = buildValoresConfigurados({
        valor: 70000,
        particular: 40000,
        cuidar: 10000,
        obrasSociales: [
          { nombre: 'PREVENCION SALUD', porcentaje: 30 },
          { nombre: 'PAMI', porcentaje: 0 },
        ],
      })

      expect(lineas).toHaveLength(4)
      expect(lineas[0]?.etiqueta).toBe('Monto diario de Cuidar:')
      expect(lineas[0]?.texto).toBe(' $ 70.000.')
      expect(lineas[1]?.etiqueta).toBe('Consulta particular:')
      expect(lineas[1]?.texto).toBe(
        ' $ 40.000 - Cuidar $ 10.000 fijos y el Médico $ 30.000.',
      )
      expect(lineas[2]?.etiqueta).toBe('Obra social PREVENCION SALUD:')
      expect(lineas[2]?.texto).toBe(' según arancel. Cuidar retiene el 30 %.')
      expect(lineas[3]?.etiqueta).toBe('Obra social PAMI:')
      expect(lineas[3]?.texto).toBe(' según arancel.')
    })

    it('porcentaje base de Cuidar (30 %)', () => {
      const lineas = buildValoresConfigurados({
        porcentaje: 30,
      })

      expect(lineas).toHaveLength(1)
      expect(lineas[0]?.etiqueta).toBe('Retención de Cuidar:')
      expect(lineas[0]?.texto).toBe(' 30 %.')
    })

    it('caso sin ningún concepto: muestra "Sin valores configurados."', () => {
      const lineasVacio = buildValoresConfigurados({})
      expect(lineasVacio).toHaveLength(1)
      expect(lineasVacio[0]?.esVacio).toBe(true)
      expect(lineasVacio[0]?.texto).toBe('Sin valores configurados.')

      const lineasNull = buildValoresConfigurados(null)
      expect(lineasNull).toHaveLength(1)
      expect(lineasNull[0]?.esVacio).toBe(true)
      expect(lineasNull[0]?.texto).toBe('Sin valores configurados.')
    })
  })

  describe('drawValoresConfiguradosBullets', () => {
    it('soporta dibujar múltiples médicos con el mismo diseño de viñetas', () => {
      const doc = new jsPDF({ format: 'a4', unit: 'mm' })
      const doctors = [
        {
          apellido: 'AYALA',
          nombre: 'MARCELA ALEJANDRA',
          especialidad: 'Psiquiatría',
          valor: 70000,
          particular: 70000,
        },
        {
          apellido: 'BUSTAMANTE',
          nombre: 'JAZMIN BELEN',
          especialidad: 'Psicóloga',
          porcentaje: 30,
        },
      ]

      const finalY = drawValoresConfiguradosBullets(doc, doctors, 100, 14, 182)
      expect(finalY).toBeGreaterThan(100)
      const text = doc.output()
      expect(text).toContain('AYALA, MARCELA ALEJANDRA')
      expect(text).toContain('BUSTAMANTE, JAZMIN BELEN')
      expect(text).toContain('Monto diario de Cuidar:')
      expect(text).toContain('Retención de Cuidar:')
    })

    it('soporta dibujar médicos en dos columnas con fuente reducida', () => {
      const doc = new jsPDF({ format: 'a4', unit: 'mm' })
      const doctors = [
        {
          apellido: 'ALFONSO',
          nombre: 'CARMEN',
          especialidad: 'Endocrinología',
          particular: 40000,
          cuidar: 10000,
        },
        {
          apellido: 'ARJOL',
          nombre: 'CARLOS O',
          especialidad: 'Urología',
        },
        {
          apellido: 'AYALA',
          nombre: 'MARCELA ALEJANDRA',
          especialidad: 'Psiquiatría',
          valor: 70000,
          particular: 70000,
        },
        {
          apellido: 'BUSTAMANTE',
          nombre: 'JAZMIN BELEN',
          especialidad: 'Psicóloga',
          porcentaje: 30,
        },
      ]

      const finalY = drawValoresConfiguradosBullets(doc, doctors, 100, 14, 182, {
        twoColumns: true,
        smallFont: true,
        anchorToBottom: true,
      })
      expect(doc.getNumberOfPages()).toBe(1)
      expect(finalY).toBeGreaterThan(260)
      const text = doc.output()
      expect(text).toContain('ALFONSO, CARMEN')
      expect(text).toContain('ARJOL, CARLOS O')
      expect(text).toContain('AYALA, MARCELA ALEJANDRA')
      expect(text).toContain('BUSTAMANTE, JAZMIN BELEN')
      expect(text).toContain('Sin valores configurados.')
    })
  })
})


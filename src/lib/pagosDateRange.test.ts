import { describe, expect, it } from 'vitest'
import {
  activateTarget,
  clearRange,
  formatButtonDate,
  formatDateRangeButtonText,
  formatRecuadroDate,
  getNextMonth,
  getPresetDateRange,
  getPrevMonth,
  nextRangeState,
  parseYMD,
  resolveListoRange,
  setTodayRange,
  toLocalNoonDate,
  type DateRangeState,
} from './pagosDateRange'

describe('pagosDateRange - Lógica pura del selector de fechas', () => {
  it('test result: ✓ Estado inicial 5/11–5/11, activo DESDE; clic 3/11 → desde 3/11, hasta 5/11, activo HASTA, no completo', () => {
    const initial: DateRangeState = {
      desde: '2026-11-05',
      hasta: '2026-11-05',
      activeTarget: 'desde',
      isRangeComplete: false,
    }

    const next = nextRangeState(initial, '2026-11-03')
    expect(next).toEqual({
      desde: '2026-11-03',
      hasta: '2026-11-05',
      activeTarget: 'hasta',
      isRangeComplete: false,
    })
  })

  it('test result: ✓ Siguiente clic 9/11 → hasta 9/11, completo', () => {
    const state: DateRangeState = {
      desde: '2026-11-03',
      hasta: '2026-11-05',
      activeTarget: 'hasta',
      isRangeComplete: false,
    }

    const next = nextRangeState(state, '2026-11-09')
    expect(next).toEqual({
      desde: '2026-11-03',
      hasta: '2026-11-09',
      activeTarget: 'hasta',
      isRangeComplete: true,
    })
  })

  it('test result: ✓ Con activo HASTA y desde 5/11, clic 2/11 → intercambio: desde 2/11, hasta 5/11, completo', () => {
    const state: DateRangeState = {
      desde: '2026-11-05',
      hasta: '2026-11-05',
      activeTarget: 'hasta',
      isRangeComplete: false,
    }

    const next = nextRangeState(state, '2026-11-02')
    expect(next).toEqual({
      desde: '2026-11-02',
      hasta: '2026-11-05',
      activeTarget: 'hasta',
      isRangeComplete: true,
    })
  })

  it('test result: ✓ Con rango completo, clic 20/11 → rango nuevo 20/11–20/11, activo HASTA, no completo', () => {
    const state: DateRangeState = {
      desde: '2026-11-03',
      hasta: '2026-11-09',
      activeTarget: 'hasta',
      isRangeComplete: true,
    }

    const next = nextRangeState(state, '2026-11-20')
    expect(next).toEqual({
      desde: '2026-11-20',
      hasta: '2026-11-20',
      activeTarget: 'hasta',
      isRangeComplete: false,
    })
  })

  it('test result: ✓ DESDE activo con hasta anterior al día elegido → hasta = día elegido', () => {
    const state: DateRangeState = {
      desde: '2026-11-02',
      hasta: '2026-11-04',
      activeTarget: 'desde',
      isRangeComplete: false,
    }

    const next = nextRangeState(state, '2026-11-10')
    expect(next).toEqual({
      desde: '2026-11-10',
      hasta: '2026-11-10',
      activeTarget: 'hasta',
      isRangeComplete: false,
    })
  })

  it('test result: ✓ Clic en recuadro DESDE o HASTA: lo activa para editarlo y quita rango completo conservando fechas', () => {
    const state: DateRangeState = {
      desde: '2026-11-03',
      hasta: '2026-11-09',
      activeTarget: 'hasta',
      isRangeComplete: true,
    }

    const editaDesde = activateTarget(state, 'desde')
    expect(editaDesde).toEqual({
      desde: '2026-11-03',
      hasta: '2026-11-09',
      activeTarget: 'desde',
      isRangeComplete: false,
    })

    const editaHasta = activateTarget(state, 'hasta')
    expect(editaHasta).toEqual({
      desde: '2026-11-03',
      hasta: '2026-11-09',
      activeTarget: 'hasta',
      isRangeComplete: false,
    })
  })

  it('test result: ✓ Borrar → fechas vacías, activo DESDE; Listo con solo DESDE → HASTA = DESDE', () => {
    const cleared = clearRange()
    expect(cleared).toEqual({
      desde: '',
      hasta: '',
      activeTarget: 'desde',
      isRangeComplete: false,
    })

    // Listo con fechas vacías
    expect(resolveListoRange(cleared)).toEqual({ desde: '', hasta: '' })

    // Usuario eligió solo DESDE pero no completó HASTA
    const soloDesde: DateRangeState = {
      desde: '2026-11-15',
      hasta: '',
      activeTarget: 'hasta',
      isRangeComplete: false,
    }
    expect(resolveListoRange(soloDesde)).toEqual({
      desde: '2026-11-15',
      hasta: '2026-11-15',
    })

    // Usuario con rango completo
    const completo: DateRangeState = {
      desde: '2026-11-10',
      hasta: '2026-11-20',
      activeTarget: 'hasta',
      isRangeComplete: true,
    }
    expect(resolveListoRange(completo)).toEqual({
      desde: '2026-11-10',
      hasta: '2026-11-20',
    })
  })

  it('test result: ✓ Hoy (botón pie de calendario): DESDE = HASTA = hoy, rango completo', () => {
    const today = setTodayRange('2026-11-08')
    expect(today).toEqual({
      desde: '2026-11-08',
      hasta: '2026-11-08',
      activeTarget: 'hasta',
      isRangeComplete: true,
    })
  })

  it('test result: ✓ Cambio de mes (diciembre→enero y viceversa) correcto', () => {
    // Diciembre (11) a Enero (0) del año siguiente
    const forward = getNextMonth(2026, 11)
    expect(forward).toEqual({ year: 2027, monthZeroBased: 0 })

    // Enero (0) a Diciembre (11) del año anterior
    const backward = getPrevMonth(2027, 0)
    expect(backward).toEqual({ year: 2026, monthZeroBased: 11 })

    // Mes ordinario
    expect(getNextMonth(2026, 4)).toEqual({ year: 2026, monthZeroBased: 5 })
    expect(getPrevMonth(2026, 4)).toEqual({ year: 2026, monthZeroBased: 3 })
  })

  it('test result: ✓ Atajos con "hoy" fijo (no dependen del reloj real)', () => {
    // 08 de noviembre de 2026 (domingo)
    const fixedNow = new Date(2026, 10, 8, 12, 0, 0)

    expect(getPresetDateRange('hoy', fixedNow)).toEqual({
      desde: '2026-11-08',
      hasta: '2026-11-08',
    })

    expect(getPresetDateRange('ayer', fixedNow)).toEqual({
      desde: '2026-11-07',
      hasta: '2026-11-07',
    })

    // Semana de Pagos (día 8 está en rango 8-14)
    expect(getPresetDateRange('semana', fixedNow)).toEqual({
      desde: '2026-11-08',
      hasta: '2026-11-14',
    })

    expect(getPresetDateRange('mes', fixedNow)).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-30',
    })

    expect(getPresetDateRange('mes-anterior', fixedNow)).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-31',
    })

    expect(getPresetDateRange('anio', fixedNow)).toEqual({
      desde: '2026-01-01',
      hasta: '2026-12-31',
    })
  })

  it('test result: ✓ Zona horaria: con TZ=America/Argentina/Buenos_Aires la fecha elegida no se corre un día', () => {
    // En UTC-3, parsear "2026-11-05" con Date UTC causaría corrimiento a "2026-11-04 21:00"
    const input = '2026-11-05'
    const parts = parseYMD(input)
    expect(parts).toEqual({ year: 2026, month: 11, day: 5 })

    // El formateador de recuadro genera exactamente "05 nov 2026"
    expect(formatRecuadroDate(input)).toBe('05 nov 2026')

    // El formateador de botón genera exactamente "05/11/2026"
    expect(formatButtonDate(input)).toBe('05/11/2026')
    expect(formatDateRangeButtonText('2026-11-05', '2026-11-05')).toBe('05/11/2026 - 05/11/2026')
    expect(formatDateRangeButtonText('2026-11-01', '2026-11-30')).toBe('01/11/2026 - 30/11/2026')

    // toLocalNoonDate garantiza mediodía local sin desborde
    const noon = toLocalNoonDate(input)
    expect(noon.getFullYear()).toBe(2026)
    expect(noon.getMonth()).toBe(10) // 10 = noviembre
    expect(noon.getDate()).toBe(5)
  })
})


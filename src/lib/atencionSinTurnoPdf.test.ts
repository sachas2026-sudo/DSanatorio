import { describe, expect, it, vi } from 'vitest'
import {
  buildAtencionSinTurnoPdf,
  buildAtencionSinTurnoTurnosPdf,
  isAtencionSinTurnoPdfPortraitA4,
} from './atencionSinTurnoPdf'

vi.mock('./pdfHeader', () => ({
  drawPdfHeader: () => 22,
  pdfBodyStartYAfterHeader: (bottom: number, extra: number) => bottom + extra + 4,
  PDF_BODY_EXTRA_DOWN_PLAIN: 2,
}))

describe('atencionSinTurnoPdf', () => {
  it('genera PDF Resumen en A4 vertical', () => {
    const { doc } = buildAtencionSinTurnoPdf(
      [
        {
          paciente: 'Pérez, Juan',
          obraSocial: 'OSDE',
          porcentaje: '30%',
          monto: '$ 1.000',
          pctCuidar: '$ 300',
        },
      ],
      true,
      { totalMonto: '$ 1.000', totalCuidar: '$ 300' },
    )

    expect(isAtencionSinTurnoPdfPortraitA4(doc)).toBe(true)
    for (let page = 1; page <= doc.getNumberOfPages(); page++) {
      doc.setPage(page)
      expect(isAtencionSinTurnoPdfPortraitA4(doc)).toBe(true)
    }
  })

  it('genera PDF Turnos en A4 vertical', () => {
    const { doc } = buildAtencionSinTurnoTurnosPdf([
      {
        paciente: 'Pérez, Juan',
        obraSocial: 'OSDE',
        observaciones: 'Control',
      },
    ])

    expect(isAtencionSinTurnoPdfPortraitA4(doc)).toBe(true)
  })
})

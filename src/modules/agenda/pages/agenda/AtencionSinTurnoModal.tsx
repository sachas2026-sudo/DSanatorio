import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { useConfirm } from '../../../../context/ConfirmContext'
import {
  atencionSinTurnoListadoForSession,
  formatAtencionSinTurnoFechaLabel,
  listAtencionSinTurnoHistorialDates,
} from '../../../../lib/atencionSinTurno'
import { formatMonto } from '../../../../lib/formatMonto'
import {
  buildAtencionSinTurnoPdf,
  buildAtencionSinTurnoTurnosPdf,
} from '../../../../lib/atencionSinTurnoPdf'
import { pdfBlobUrl } from '../../../../lib/doctorPaymentsPdf'
import { computeDoctorPorcentajeSettlement } from '../../../../lib/pagosPdfLayout'
import { IconActionButton, IconTrash } from '../../../../shared/components/icons'
import type { AtencionSinTurnoListado, Doctor, Patient } from '../../../../types'
import './atencion-sin-turno-modal.css'

type Row = {
  id: string
  patientId: string
  monto: string
}

type SaveEntry = {
  patientId: string
  monto: number
}

type Props = {
  doctors: Doctor[]
  patients: Patient[]
  patientById: (id: string) => Patient | undefined
  listados: AtencionSinTurnoListado[]
  puedeVerPorcentaje: boolean
  onClose: () => void
  onSave: (payload: {
    doctorId: string
    entries: SaveEntry[]
    fecha: string
  }) => void
  onDelete: (payload: { doctorId: string; fecha: string }) => void
  onSaveError: (message: string) => void
  onPdfPreview: (payload: {
    url: string
    filename: string
    title: string
    doc: ReturnType<typeof buildAtencionSinTurnoPdf>['doc']
  }) => void
  onPdfError: (message: string) => void
}

function newRowId(): string {
  return `ast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const AST_DEFAULT_ROW_COUNT = 8

function emptyRows(count = AST_DEFAULT_ROW_COUNT): Row[] {
  return Array.from({ length: count }, () => ({
    id: newRowId(),
    patientId: '',
    monto: '',
  }))
}

function formatPct(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '0'
  return String(Math.round(n))
}

function parseMontoInput(value: string): number | null {
  const digits = value.replace(/[^\d.,]/g, '').replace(',', '.')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function formatPctCuidar(
  monto: number | null,
  porcentaje?: number,
): string {
  if (porcentaje == null || !Number.isFinite(porcentaje)) {
    return ''
  }
  return formatMonto(
    computeDoctorPorcentajeSettlement(monto ?? 0, porcentaje).totalPorcentaje,
  )
}

function computeAstTotals(
  rows: Row[],
  porcentaje?: number,
): { totalMonto: number; totalCuidar: number } {
  let totalMonto = 0
  let totalCuidar = 0
  for (const r of rows) {
    const m = parseMontoInput(r.monto) ?? 0
    totalMonto += m
    if (porcentaje != null && Number.isFinite(porcentaje)) {
      totalCuidar += computeDoctorPorcentajeSettlement(m, porcentaje)
        .totalPorcentaje
    }
  }
  return {
    totalMonto: Math.round(totalMonto * 100) / 100,
    totalCuidar: Math.round(totalCuidar * 100) / 100,
  }
}

function patientObraSocialLabel(
  patientId: string,
  patientById: (id: string) => Patient | undefined,
): string {
  if (!patientId) return ''
  return patientById(patientId)?.obraSocial?.trim() ?? ''
}

function buildPdfMetaLine(doctor: Doctor | null, fechaYmd: string): string {
  const parts: string[] = []
  if (doctor) parts.push(`${doctor.apellido}, ${doctor.nombre}`)
  parts.push(formatAtencionSinTurnoFechaLabel(fechaYmd))
  return parts.join(' · ')
}

function rowsFromSavedListado(
  saved: AtencionSinTurnoListado | null,
): Row[] {
  if (!saved) return emptyRows()
  const loaded = saved.filas.map((f) => ({
    id: newRowId(),
    patientId: f.patientId,
    monto: String(f.monto),
  }))
  if (loaded.length === 0) return emptyRows()
  if (loaded.length >= AST_DEFAULT_ROW_COUNT) return loaded
  return [...loaded, ...emptyRows(AST_DEFAULT_ROW_COUNT - loaded.length)]
}

function rowsFromEntries(entries: SaveEntry[]): Row[] {
  const loaded = entries.map((e) => ({
    id: newRowId(),
    patientId: e.patientId,
    monto: String(e.monto),
  }))
  if (loaded.length >= AST_DEFAULT_ROW_COUNT) return loaded
  return [...loaded, ...emptyRows(AST_DEFAULT_ROW_COUNT - loaded.length)]
}

export function AtencionSinTurnoModal({
  doctors,
  patients,
  patientById,
  listados,
  puedeVerPorcentaje,
  onClose,
  onSave,
  onDelete,
  onSaveError,
  onPdfPreview,
  onPdfError,
}: Props) {
  const { confirm } = useConfirm()
  const [doctorId, setDoctorId] = useState('')
  const [fecha, setFecha] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [historialFecha, setHistorialFecha] = useState('')
  const [rows, setRows] = useState<Row[]>(() => emptyRows())

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const doctor = useMemo(
    () => doctors.find((d) => d.id === doctorId) ?? null,
    [doctors, doctorId],
  )

  const pctLabel = formatPct(doctor?.porcentaje)

  const sortedDoctors = useMemo(
    () =>
      [...doctors].sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(
          `${b.apellido} ${b.nombre}`,
          'es',
          { sensitivity: 'base' },
        ),
      ),
    [doctors],
  )

  const sortedPatients = useMemo(
    () =>
      [...patients].sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(
          `${b.apellido} ${b.nombre}`,
          'es',
          { sensitivity: 'base' },
        ),
      ),
    [patients],
  )

  const historialOptions = useMemo(
    () => listAtencionSinTurnoHistorialDates(listados, doctorId),
    [listados, doctorId],
  )

  function loadSavedSession(fechaYmd: string) {
    if (!doctorId || !fechaYmd) return
    const saved = atencionSinTurnoListadoForSession(listados, doctorId, fechaYmd)
    setFecha(fechaYmd)
    setHistorialFecha(fechaYmd)
    setRows(rowsFromSavedListado(saved))
  }

  useEffect(() => {
    setHistorialFecha('')
    setFecha(format(new Date(), 'yyyy-MM-dd'))
    setRows(emptyRows())
  }, [doctorId])

  const totals = useMemo(
    () => computeAstTotals(rows, doctor?.porcentaje),
    [rows, doctor?.porcentaje],
  )

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { id: newRowId(), patientId: '', monto: '' }])
  }

  function removeRow(id: string) {
    setRows((prev) => {
      if (prev.length <= 1) {
        return [{ id: newRowId(), patientId: '', monto: '' }]
      }
      return prev.filter((r) => r.id !== id)
    })
  }

  async function confirmRemoveRow(row: Row) {
    const p = row.patientId ? patientById(row.patientId) : undefined
    const patientLabel = p ? `${p.apellido}, ${p.nombre}` : null
    const message = patientLabel
      ? `¿Quitar a ${patientLabel} de esta fila?`
      : '¿Quitar esta fila del listado?'

    const ok = await confirm({
      title: 'Quitar fila',
      message,
      confirmLabel: 'Quitar',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return
    removeRow(row.id)
  }

  function collectValidEntries(): SaveEntry[] | null {
    if (!doctor) {
      onSaveError('Elegí un médico antes de guardar.')
      return null
    }

    const entries = rows
      .map((r) => {
        const monto = parseMontoInput(r.monto)
        if (!r.patientId || monto == null || monto <= 0) return null
        return { patientId: r.patientId, monto }
      })
      .filter((x): x is SaveEntry => x != null)

    if (entries.length === 0) {
      onSaveError('Completá al menos un paciente y un monto.')
      return null
    }

    return entries
  }

  function handleSave() {
    const entries = collectValidEntries()
    if (!entries || !doctor) return
    onSave({ doctorId: doctor.id, entries, fecha })
    setHistorialFecha(fecha)
    setRows(rowsFromEntries(entries))
  }

  async function handleDelete() {
    if (!doctorId) {
      onSaveError('Elegí un médico antes de eliminar.')
      return
    }
    if (!fecha) {
      onSaveError('Elegí una fecha antes de eliminar.')
      return
    }

    const saved = atencionSinTurnoListadoForSession(listados, doctorId, fecha)
    const doctorLabel = doctor
      ? `${doctor.apellido}, ${doctor.nombre}`
      : '—'
    const fechaLabel = formatAtencionSinTurnoFechaLabel(fecha)

    const message =
      saved
        ? `¿Eliminar el listado de atención sin turno?\n\nMédico: ${doctorLabel}\nFecha: ${fechaLabel}\n\nSe borrarán ${saved.filas.length} registro${saved.filas.length === 1 ? '' : 's'} guardado${saved.filas.length === 1 ? '' : 's'}. Esta acción no se puede deshacer.`
        : `¿Vaciar el listado y la fecha seleccionada?\n\nMédico: ${doctorLabel}\nFecha: ${fechaLabel}\n\nNo hay listados guardados para esta fecha; solo se limpiará el formulario.`

    const ok = await confirm({
      title: 'Eliminar listado',
      message,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return

    if (saved) {
      onDelete({ doctorId, fecha })
    }

    setHistorialFecha('')
    setFecha(format(new Date(), 'yyyy-MM-dd'))
    setRows(emptyRows())
  }

  function buildExportRows() {
    return rows.map((r) => {
      const p = r.patientId ? patientById(r.patientId) : undefined
      const parsedMonto = parseMontoInput(r.monto)
      const hasMonto = parsedMonto != null && parsedMonto > 0
      return {
        paciente: p ? `${p.apellido}, ${p.nombre}` : '',
        obraSocial: r.patientId
          ? patientObraSocialLabel(r.patientId, patientById)
          : '',
        porcentaje:
          hasMonto && puedeVerPorcentaje && doctorId ? pctLabel : '',
        monto: hasMonto ? formatMonto(parsedMonto) : '',
        pctCuidar:
          hasMonto && puedeVerPorcentaje && doctorId
            ? formatPctCuidar(parsedMonto, doctor?.porcentaje)
            : '',
        observaciones: p?.notas?.trim() ?? '',
      }
    })
  }

  function handlePdf() {
    const exportRows = buildExportRows()

    try {
      const built = buildAtencionSinTurnoPdf(exportRows, puedeVerPorcentaje, {
        subtitle: buildPdfMetaLine(doctor, fecha),
        totalMonto:
          totals.totalMonto > 0 ? formatMonto(totals.totalMonto) : '',
        totalCuidar:
          puedeVerPorcentaje && totals.totalCuidar > 0
            ? formatMonto(totals.totalCuidar)
            : undefined,
      })
      onPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
        doc: built.doc,
      })
    } catch (err) {
      console.error(err)
      onPdfError('No se pudo generar el PDF. Probá de nuevo.')
    }
  }

  function handlePdfTurnos() {
    const exportRows = buildExportRows().map((r) => ({
      paciente: r.paciente,
      obraSocial: r.obraSocial,
      observaciones: r.observaciones,
    }))

    try {
      const built = buildAtencionSinTurnoTurnosPdf(exportRows, {
        subtitle: buildPdfMetaLine(doctor, fecha),
      })
      onPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
        doc: built.doc,
      })
    } catch (err) {
      console.error(err)
      onPdfError('No se pudo generar el PDF. Probá de nuevo.')
    }
  }

  return (
    <div
      className="atencion-sin-turno-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="atencion-sin-turno-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atencion-sin-turno-title"
      >
        <header className="atencion-sin-turno-sheet__head">
          <h2 id="atencion-sin-turno-title">Atención sin turno</h2>
        </header>

        <div className="atencion-sin-turno-sheet__body">
          <div className="atencion-sin-turno-toolbar">
            <div className="field atencion-sin-turno-toolbar__field atencion-sin-turno-toolbar__field--medico">
              <label htmlFor="ast-doctor">Médico</label>
              <select
                id="ast-doctor"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
              >
                <option value="">Elegir…</option>
                {sortedDoctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.apellido}, {d.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="field atencion-sin-turno-toolbar__field atencion-sin-turno-toolbar__field--historial">
              <label htmlFor="ast-historial">Historial</label>
              <select
                id="ast-historial"
                value={historialFecha}
                onChange={(e) => {
                  const value = e.target.value
                  if (!value) {
                    setHistorialFecha('')
                    return
                  }
                  loadSavedSession(value)
                }}
                disabled={!doctorId || historialOptions.length === 0}
              >
                <option value="">
                  {historialOptions.length === 0
                    ? 'Sin listados guardados'
                    : 'Elegir fecha…'}
                </option>
                {historialOptions.map((fechaYmd) => (
                  <option key={fechaYmd} value={fechaYmd}>
                    {formatAtencionSinTurnoFechaLabel(fechaYmd)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field atencion-sin-turno-toolbar__field atencion-sin-turno-toolbar__field--fecha">
              <label htmlFor="ast-fecha">Fecha (dd-mm-aa)</label>
              <input
                id="ast-fecha"
                type="date"
                value={fecha}
                onChange={(e) => {
                  const value = e.target.value
                  setFecha(value)
                  if (historialOptions.includes(value)) {
                    loadSavedSession(value)
                  } else {
                    setHistorialFecha('')
                  }
                }}
              />
            </div>
          </div>

          <div className="table-wrap table-wrap--scroll atencion-sin-turno-table-wrap">
            <div className="table-list__scroll">
              <table className="data atencion-sin-turno-table">
              <thead>
                <tr>
                  <th scope="col" className="atencion-sin-turno-table__col-paciente">
                    Paciente
                  </th>
                  <th scope="col" className="atencion-sin-turno-table__col-obra">
                    Obra Social
                  </th>
                  {puedeVerPorcentaje && (
                    <th scope="col" className="atencion-sin-turno-table__col-pct">
                      %
                    </th>
                  )}
                  <th scope="col" className="atencion-sin-turno-table__col-monto">
                    Monto
                  </th>
                  {puedeVerPorcentaje && (
                    <th scope="col" className="atencion-sin-turno-table__col-cuidar">
                      % Cuidar
                    </th>
                  )}
                  <th scope="col" aria-label="Quitar fila" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="atencion-sin-turno-table__col-paciente">
                      <select
                        className="atencion-sin-turno-table__paciente-select"
                        value={r.patientId}
                        onChange={(e) =>
                          updateRow(r.id, { patientId: e.target.value })
                        }
                        aria-label="Paciente"
                      >
                        <option value=""></option>
                        {sortedPatients.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.apellido}, {p.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="atencion-sin-turno-table__col-obra">
                      {patientObraSocialLabel(r.patientId, patientById) || '—'}
                    </td>
                    {puedeVerPorcentaje && (
                      <td>
                        <span className="atencion-sin-turno-table__pct">
                          {doctorId ? pctLabel : ''}
                        </span>
                      </td>
                    )}
                    <td className="atencion-sin-turno-table__col-monto">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="atencion-sin-turno-table__monto-input"
                        placeholder="0"
                        value={r.monto}
                        onChange={(e) =>
                          updateRow(r.id, { monto: e.target.value })
                        }
                        aria-label="Monto"
                      />
                    </td>
                    {puedeVerPorcentaje && (
                      <td className="atencion-sin-turno-table__col-cuidar">
                        <span className="atencion-sin-turno-table__cuidar">
                          {doctorId
                            ? formatPctCuidar(
                                parseMontoInput(r.monto),
                                doctor?.porcentaje,
                              )
                            : ''}
                        </span>
                      </td>
                    )}
                    <td>
                      <div className="row-actions">
                        <IconActionButton
                          variant="delete"
                          label="Quitar fila"
                          onClick={() => void confirmRemoveRow(r)}
                        >
                          <IconTrash />
                        </IconActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="atencion-sin-turno-table__totals-row">
                  <td
                    colSpan={puedeVerPorcentaje ? 3 : 2}
                    className="atencion-sin-turno-table__totals-label"
                  >
                    TOTALES
                  </td>
                  <td className="atencion-sin-turno-table__col-monto atencion-sin-turno-table__totals-monto">
                    {formatMonto(totals.totalMonto)}
                  </td>
                  {puedeVerPorcentaje && (
                    <td className="atencion-sin-turno-table__col-cuidar atencion-sin-turno-table__totals-cuidar">
                      {doctorId ? formatMonto(totals.totalCuidar) : ''}
                    </td>
                  )}
                  <td aria-hidden />
                </tr>
              </tfoot>
              </table>
            </div>
          </div>

        </div>

        <footer className="atencion-sin-turno-sheet__foot">
          <div className="atencion-sin-turno-sheet__foot-start">
            <button
              type="button"
              className="btn btn-ghost atencion-sin-turno-add-row"
              onClick={addRow}
            >
              + Agregar fila
            </button>
            <button
              type="button"
              className="btn btn-danger atencion-sin-turno-sheet__eliminar"
              onClick={() => void handleDelete()}
              disabled={!doctorId}
            >
              Eliminar
            </button>
          </div>
          <div className="atencion-sin-turno-sheet__foot-actions">
            <button
              type="button"
              className="btn btn-pdf"
              onClick={handlePdf}
              title="Generar PDF resumen del listado"
            >
              PDF Resumen
            </button>
            <button
              type="button"
              className="btn btn-pdf"
              onClick={handlePdfTurnos}
              title="PDF con Paciente, Obra social y Observaciones"
            >
              PDF Turnos
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
            >
              Guardar
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

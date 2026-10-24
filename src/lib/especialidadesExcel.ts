import { isTauri } from '@tauri-apps/api/core'
import * as XLSX from 'xlsx/xlsx.mjs'
import type { Doctor } from '../types'

export type EspecialidadesExcelInput = {
  doctors: Doctor[]
}

export function buildEspecialidadesExcel(input: EspecialidadesExcelInput): XLSX.WorkBook {
  const { doctors } = input
  const sorted = [...doctors].sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
      sensitivity: 'base',
    }),
  )

  const rows = sorted.map((d) => {
    const nombre = `${d.apellido || ''}, ${d.nombre || ''}`.trim()
    const especialidad = (d.especialidad || '').trim()
    return [nombre, especialidad]
  })

  const sheet = XLSX.utils.aoa_to_sheet([
    ['Médico', 'Especialidad'],
    ...rows,
  ])

  sheet['!cols'] = [
    { wch: 35 },
    { wch: 30 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Especialidades')
  return wb
}

export function workbookToXlsxBytes(wb: XLSX.WorkBook): Uint8Array {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Uint8Array(buf)
}

export function especialidadesExcelFilename(): string {
  const stamp = new Date().toISOString().slice(0, 10)
  return `especialidades-medicos-${stamp}.xlsx`
}

export async function saveEspecialidadesExcelFile(
  wb: XLSX.WorkBook,
  filename: string,
): Promise<void> {
  const bytes = workbookToXlsxBytes(wb)
  const name = filename.trim() || 'especialidades-medicos.xlsx'

  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_excel_dialog', {
      defaultFilename: name,
      fileBase64: bytesToBase64(bytes),
    })
    return
  }

  const blob = new Blob([new Uint8Array(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

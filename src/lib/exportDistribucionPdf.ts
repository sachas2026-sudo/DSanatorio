import type jsPDF from 'jspdf'
import { isTauri } from '@tauri-apps/api/core'

/**
 * Guardado del PDF de "Distribución por médico · Obras sociales".
 *
 * Va por su propio comando (`export_distribucion_pdf`) y no por el
 * `save_pdf_dialog` que usan el resto de los reportes, porque aquel devuelve un
 * booleano y esta pantalla necesita la ruta: la muestra junto a un "Abrir" para
 * que el usuario llegue al archivo sin buscarlo.
 */

/** Bytes del PDF en base64. */
function pdfToBase64(doc: jsPDF): string {
  const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/**
 * Abre el diálogo de guardado y escribe el archivo.
 *
 * Devuelve la ruta final, o `null` si el usuario canceló. `null` no es un
 * error: no hay nada que avisar y la pantalla queda como estaba.
 *
 * Fuera de Tauri (en el navegador durante el desarrollo) cae a una descarga
 * normal, que es lo que hace el resto de los reportes.
 */
export async function exportDistribucionPdf(
  doc: jsPDF,
  filename: string,
): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string | null>('export_distribucion_pdf', {
      defaultFilename: filename,
      pdfBase64: pdfToBase64(doc),
    })
  }

  const url = doc.output('bloburl')
  const link = document.createElement('a')
  link.href = url as unknown as string
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return filename
}

/** Abre un archivo con la aplicación que el sistema tenga asociada. */
export async function abrirArchivo(path: string): Promise<void> {
  if (!isTauri()) {
    window.open(path, '_blank', 'noopener')
    return
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('abrir_archivo', { path })
}

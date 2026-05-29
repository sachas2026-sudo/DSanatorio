/** Nombre visible de la institución (UI, PDF, correos). */
export const APP_DISPLAY_NAME = 'Centro Medico'

/** Alias para encabezados PDF y asuntos de correo. */
export const PDF_BRAND_NAME = APP_DISPLAY_NAME

/** Guión corto entre partes de un título de PDF (no em dash). */
export const PDF_TITLE_DASH = ' - '

export function brandGestiónLine(): string {
  return `${PDF_BRAND_NAME} — Gestión`
}

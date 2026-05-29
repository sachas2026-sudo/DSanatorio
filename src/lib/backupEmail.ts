import { format } from 'date-fns'
import { brandGestiónLine, PDF_BRAND_NAME } from './pdfBranding'
import { es } from 'date-fns/locale'
import type { AppSettings } from '../types'
import {
  isGmailAddress,
  sendAgendaEmailSmtp,
  validateGmailAppPassword,
  normalizeGmailAppPassword,
} from './agendaEmail'
import { resolveSmtpPassword } from './smtpSecret'

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function backupAttachmentFilename(): string {
  const stamp = format(new Date(), 'yyyy-MM-dd-HHmm', { locale: es })
  return `sanatorio-datos-${stamp}.json`
}

function validateBackupEmailSettings(settings: AppSettings): string | null {
  const from = settings.email.trim()
  const to = settings.emailGerente.trim()
  if (!from) {
    return 'Cargá el Email en Configuración (remitente) y pulsá Guardar.'
  }
  if (!to) {
    return 'Cargá el Email Gerente en Configuración y pulsá Guardar.'
  }
  if (isGmailAddress(from)) {
    return validateGmailAppPassword(normalizeGmailAppPassword(settings.clave))
  }
  if (!settings.clave.trim()) {
    return 'Cargá la Clave del correo en Configuración y pulsá Guardar.'
  }
  return null
}

export function buildDatabaseBackupEmailBody(params: {
  whenLabel: string
  filename: string
}): string {
  return [
    brandGestiónLine(),
    'Copia de resguardo de la base de datos',
    '',
    `Generada: ${params.whenLabel}`,
    `Archivo adjunto: ${params.filename}`,
    '',
    'Contiene pacientes, médicos, turnos, pagos y configuración.',
    'Guardalo en un lugar seguro. Para restaurar en otra PC, reemplazá',
    'sanatorio-datos.json en AppData o usá «Recuperar respaldo» en Configuración.',
    '',
    'Este mensaje puede incluir datos personales; no lo reenvíes sin necesidad.',
  ].join('\n')
}

/** Envía la base JSON al Email Gerente (Gmail u otro SMTP configurado). */
export async function sendDatabaseBackupEmail(
  settings: AppSettings,
  json: string,
): Promise<void> {
  const clave = await resolveSmtpPassword(settings)
  const settingsWithClave = { ...settings, clave }
  const validationError = validateBackupEmailSettings(settingsWithClave)
  if (validationError) {
    throw new Error(validationError)
  }

  const whenLabel = format(new Date(), 'dd-MM-yyyy HH:mm', { locale: es })
  const filename = backupAttachmentFilename()

  await sendAgendaEmailSmtp({
    from: settings.email.trim(),
    password: clave,
    to: settings.emailGerente.trim(),
    subject: `${PDF_BRAND_NAME} — Copia de base de datos — ${whenLabel}`,
    body: buildDatabaseBackupEmailBody({ whenLabel, filename }),
    pdfBase64: utf8ToBase64(json),
    pdfFilename: filename,
    attachmentMime: 'application/json',
  })
}

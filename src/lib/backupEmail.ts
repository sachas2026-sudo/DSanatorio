import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { zipSync, strToU8 } from 'fflate'
import { brandGestiónLine, PDF_BRAND_NAME } from './pdfBranding'
import type { AppSettings } from '../types'
import {
  isGmailAddress,
  sendAgendaEmailSmtp,
  validateGmailAppPassword,
  normalizeGmailAppPassword,
} from './agendaEmail'
import { resolveSmtpPassword, loadSmtpSecret } from './smtpSecret'
import { loadAuthAccountsRaw } from './authAccountsStorage'

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function backupZipFilename(): string {
  const stamp = format(new Date(), 'yyyy-MM-dd-HHmm', { locale: es })
  return `sanatorio-respaldo-${stamp}.zip`
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
    'El ZIP incluye sanatorio-datos.json y, si existen, los archivos de',
    'usuarios/contraseñas y clave SMTP (auth-accounts.json, smtp-secret.txt).',
    '',
    'Guardalo en un lugar seguro. Para restaurar en otra PC, descomprimí el ZIP en',
    'C:\\Sanatorio\\datos (JSON principal) y en la carpeta de respaldo correspondiente',
    'o usá «Recuperar respaldo» en Configuración.',
    '',
    'Este mensaje puede incluir datos personales y contraseñas; no lo reenvíes sin necesidad.',
  ].join('\n')
}

async function buildBackupEmailZip(mainJson: string): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'sanatorio-datos.json': strToU8(mainJson),
  }

  const auth = await loadAuthAccountsRaw()
  if (auth.trim()) {
    files['auth-accounts.json'] = strToU8(auth)
  }

  const smtp = await loadSmtpSecret()
  if (smtp.trim()) {
    files['smtp-secret.txt'] = strToU8(smtp)
  }

  return zipSync(files)
}

/** Envía ZIP con base JSON + archivos companion al Email Gerente. */
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
  const filename = backupZipFilename()
  const zipBytes = await buildBackupEmailZip(json)

  await sendAgendaEmailSmtp({
    from: settings.email.trim(),
    password: clave,
    to: settings.emailGerente.trim(),
    subject: `${PDF_BRAND_NAME} — Copia de base de datos — ${whenLabel}`,
    body: buildDatabaseBackupEmailBody({ whenLabel, filename }),
    pdfBase64: bytesToBase64(zipBytes),
    pdfFilename: filename,
    attachmentMime: 'application/zip',
  })
}

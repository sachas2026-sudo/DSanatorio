import { isTauri } from '@tauri-apps/api/core'
import { brandGestiónLine } from './pdfBranding'
import type { AgendaWeekPdfRow } from './agendaWeekPdf'

export function buildAgendaWeekEmailBody(
  weekLabel: string,
  rows: AgendaWeekPdfRow[],
): string {
  const lines: string[] = [
    brandGestiónLine(),
    `Agenda semanal — ${weekLabel}`,
    '',
  ]

  if (rows.length === 0) {
    lines.push('No hay turnos programados en esta semana.')
    return lines.join('\n')
  }

  let lastDia = ''
  for (const r of rows) {
    if (r.dia !== lastDia) {
      if (lastDia) lines.push('')
      lines.push(r.dia)
      lastDia = r.dia
    }
    lines.push(
      `  ${r.hora}  |  ${r.paciente}  |  ${r.medico}  |  ${r.obraSocial}  |  ${r.monto}  |  ${r.estado}  |  ${r.obs}`,
    )
  }

  return lines.join('\n')
}

export function buildAgendaEmailBodyWithPdf(params: {
  periodLabel: string
  pdfFilename: string
  cantidadTurnos: number
}): string {
  const lines = [
    brandGestiónLine(),
    `Agenda — ${params.periodLabel}`,
    '',
    'Se adjunta el mismo informe PDF que en «Vista previa».',
    `Archivo: ${params.pdfFilename}`,
    '',
    `Cantidad de turnos: ${params.cantidadTurnos}`,
  ]
  return lines.join('\n')
}

export function buildMailtoUrl(
  to: string,
  subject: string,
  body: string,
): string {
  const params = new URLSearchParams()
  params.set('subject', subject)
  params.set('body', body)
  return `mailto:${encodeURIComponent(to)}?${params.toString()}`
}

export type SendAgendaEmailParams = {
  from: string
  password: string
  to: string
  subject: string
  body: string
  smtpHost?: string
  smtpPort?: number
  /** Adjunto en base64 (PDF, JSON, etc.). */
  pdfBase64?: string
  pdfFilename?: string
  /** Tipo MIME del adjunto; por defecto PDF o según extensión del nombre. */
  attachmentMime?: string
}

export function isGmailAddress(email: string): boolean {
  const domain = email.trim().split('@')[1]?.toLowerCase()
  return domain === 'gmail.com' || domain === 'googlemail.com'
}

/** Igual que Admi: quita espacios de la contraseña de aplicación Gmail. */
export function normalizeGmailAppPassword(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, '')
}

/** Valida clave Gmail (16 caracteres). Devuelve mensaje de error o null si OK. */
export function validateGmailAppPassword(clean: string): string | null {
  if (!clean) {
    return 'Cargá la Clave del correo en Configuración y pulsá Guardar.'
  }
  if (clean.length !== 16) {
    return 'La contraseña de aplicación de Gmail debe tener 16 caracteres (podés pegarla con espacios; la app los quita). Creala en https://myaccount.google.com/apppasswords'
  }
  return null
}

export function isSmtpAuthError(message: string): boolean {
  const l = message.toLowerCase()
  return (
    l.includes('535') ||
    l.includes('534') ||
    l.includes('authentication') ||
    l.includes('authenticate') ||
    l.includes('credential') ||
    l.includes('contraseña de aplicación') ||
    l.includes('no se pudo enviar')
  )
}

export async function openAgendaEmailDraft(params: {
  from: string
  to: string
  subject: string
  body: string
  pdfBase64?: string
  pdfFilename?: string
}): Promise<void> {
  if (!isTauri()) {
    throw new Error(
      'Abrir borrador de correo solo está disponible en la aplicación de escritorio.',
    )
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('open_agenda_email_draft', {
    from: params.from.trim(),
    to: params.to.trim(),
    subject: params.subject,
    body: params.body,
    pdfBase64: params.pdfBase64 ?? null,
    pdfFilename: params.pdfFilename ?? null,
  })
}

export async function sendAgendaEmailSmtp(
  params: SendAgendaEmailParams,
): Promise<void> {
  if (!isTauri()) {
    throw new Error(
      'El envío con remitente y clave solo está disponible en la aplicación de escritorio.',
    )
  }
  const { invoke } = await import('@tauri-apps/api/core')
  const from = params.from.trim()
  const to = params.to.trim()

  if (isGmailAddress(from)) {
    const appPassClean = normalizeGmailAppPassword(params.password)
    const validationError = validateGmailAppPassword(appPassClean)
    if (validationError) {
      throw new Error(validationError)
    }
    await invoke('send_email_gmail', {
      payload: {
        from_email: from,
        app_password: appPassClean,
        to: [to],
        subject: params.subject,
        body: params.body,
        pdf_base64: params.pdfBase64 ?? null,
        pdf_filename: params.pdfFilename ?? null,
        attachment_mime: params.attachmentMime ?? null,
      },
    })
    return
  }

  await invoke('send_agenda_email', {
    from,
    password: params.password,
    to,
    subject: params.subject,
    body: params.body,
    smtpHost: params.smtpHost?.trim() || null,
    smtpPort: params.smtpPort ?? null,
    pdfBase64: params.pdfBase64 ?? null,
    pdfFilename: params.pdfFilename ?? null,
    attachmentMime: params.attachmentMime ?? null,
  })
}

export async function openMailtoUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }
  window.location.href = url
}

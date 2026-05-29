import { isTauri } from '@tauri-apps/api/core'

/** Normaliza teléfono argentino para enlace wa.me (solo dígitos, con 54). */
export function normalizePhoneForWhatsApp(telefono: string): string | null {
  let digits = telefono.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)

  if (digits.startsWith('54')) {
    return digits.length >= 12 && digits.length <= 15 ? digits : null
  }
  if (digits.startsWith('0')) {
    digits = `54${digits.slice(1)}`
  } else if (digits.length === 10 || digits.length === 11) {
    digits = `54${digits}`
  } else {
    return null
  }

  return digits.length >= 12 && digits.length <= 15 ? digits : null
}

export function buildWhatsAppSendUrl(
  telefono: string,
  mensaje: string,
): string | null {
  const phone = normalizePhoneForWhatsApp(telefono)
  if (!phone) return null
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`
}

/** Enlace directo a la app de escritorio (Windows/macOS). */
export function buildWhatsAppDesktopUrl(
  telefono: string,
  mensaje: string,
): string | null {
  const phone = normalizePhoneForWhatsApp(telefono)
  if (!phone) return null
  return `whatsapp://send?phone=${phone}&text=${encodeURIComponent(mensaje)}`
}

export function buildTurnoReminderMessage(params: {
  medicoLabel: string
  fechaLabel: string
  hora: string
}): string {
  const { medicoLabel, fechaLabel, hora } = params
  return `Buenos días, le recordamos su turno el ${fechaLabel} a las ${hora} con el Doctor ${medicoLabel}. Por favor confirmar su asistencia. Muchas Gracias. Gestion Medica.`
}

export type TurnoLineaAgenda = { hora: string; paciente: string }

export function buildMedicoAgendaMessage(params: {
  medicoLabel: string
  fechaLabel: string
  manana: TurnoLineaAgenda[]
  tarde: TurnoLineaAgenda[]
}): string {
  const { medicoLabel, fechaLabel, manana, tarde } = params
  const lines: string[] = [
    `Buenos días Doctor ${medicoLabel}. Agenda del ${fechaLabel}:`,
  ]

  if (manana.length > 0) {
    lines.push('Turnos Mañana')
    for (const t of manana) {
      lines.push(`${t.hora} ${t.paciente}`)
    }
  }

  if (tarde.length > 0) {
    if (manana.length > 0) lines.push('')
    lines.push('Turno Tarde')
    for (const t of tarde) {
      lines.push(`${t.hora} ${t.paciente}`)
    }
  }

  return lines.join('\n')
}

async function openUrlWithOpener(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

/** Abre WhatsApp (app de escritorio o wa.me en el navegador). */
export async function openWhatsAppUrl(
  telefono: string,
  mensaje: string,
): Promise<void> {
  const webUrl = buildWhatsAppSendUrl(telefono, mensaje)
  if (!webUrl) {
    throw new Error('Teléfono inválido para WhatsApp')
  }

  if (!isTauri()) {
    const opened = window.open(webUrl, '_blank', 'noopener,noreferrer')
    if (!opened) window.location.assign(webUrl)
    return
  }

  const desktopUrl = buildWhatsAppDesktopUrl(telefono, mensaje)
  if (desktopUrl) {
    try {
      await openUrlWithOpener(desktopUrl)
      return
    } catch {
      /* Sin app de escritorio o protocolo no registrado → wa.me */
    }
  }

  await openUrlWithOpener(webUrl)
}

import { addWeeks, format, parseISO, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { isTauri } from '@tauri-apps/api/core'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { especialidadKey, normalizeEspecialidad } from './especialidades'
import type { Appointment } from '../types'

/** Normaliza teléfono argentino para enlace wa.me (solo dígitos, con 549 para móviles). */
export function normalizePhoneForWhatsApp(telefono: string): string | null {
  let digits = telefono.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)

  if (digits.startsWith('54')) {
    let rest = digits.slice(2)
    if (!(rest.startsWith('9') && (rest.length === 11 || rest.length === 12))) {
      if (rest.length === 10 || rest.length === 11) {
        rest = `9${rest}`
      } else {
        return null
      }
    }
    digits = `54${rest}`
  } else if (digits.startsWith('0')) {
    const rest = digits.slice(1)
    if (rest.length !== 10 && rest.length !== 11) return null
    digits = `549${rest}`
  } else if (digits.length === 10 || digits.length === 11) {
    digits = `549${digits}`
  } else {
    return null
  }

  return digits.length >= 13 && digits.length <= 15 ? digits : null
}

export function buildWhatsAppSendUrl(
  telefono: string,
  mensaje: string,
): string | null {
  const phone = normalizePhoneForWhatsApp(telefono)
  if (!phone) return null
  return `whatsapp://send?phone=${phone}&text=${encodeURIComponent(mensaje)}`
}

/** Alias de buildWhatsAppSendUrl (app de escritorio). */
export function buildWhatsAppDesktopUrl(
  telefono: string,
  mensaje: string,
): string | null {
  return buildWhatsAppSendUrl(telefono, mensaje)
}

/** Genera un enlace de WhatsApp Web para abrirlo en el navegador. */
export function buildWhatsAppWebUrl(
  telefono: string,
  mensaje: string,
): string | null {
  const phone = normalizePhoneForWhatsApp(telefono)
  if (!phone) return null
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(mensaje)}`
}

/** Genera un enlace wa.me para WhatsApp (puede funcionar mejor embebido). */
export function buildWaMeUrl(
  telefono: string,
  mensaje: string,
): string | null {
  const phone = normalizePhoneForWhatsApp(telefono)
  if (!phone) return null
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`
}

export function saludoWhatsApp(ahora: Date = new Date()): string {
  const h = ahora.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

export function formatTurnoFechaWhatsApp(fecha: Date): string {
  const dia = format(fecha, 'EEEE', { locale: es })
  const diaCap = dia.charAt(0).toUpperCase() + dia.slice(1)
  const fechaNum = format(fecha, 'dd-MM', { locale: es })
  return `${diaCap} ${fechaNum} del cte. Año`
}

/** Fecha calendario del turno en la agenda (día local, sin desfase por hora). */
export function fechaCalendarioTurnoAgenda(fechaHoraIso: string): Date {
  const parsed = parseISO(fechaHoraIso)
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0)
}

function turnoRecordatorioIntroWhatsApp(fechaTurno: Date, hora?: string): string {
  const fechaLabel = formatTurnoFechaWhatsApp(fechaTurno)
  if (hora?.trim()) {
    return `para el día de mañana ${fechaLabel},  a las ${hora.trim()}`
  }
  return `para el día de mañana ${fechaLabel}`
}

/** Nombre corto de la especialidad para WhatsApp (ej. Neurología → Neurologa). */
export function especialidadWhatsAppNombre(especialidad: string): string {
  const e = normalizeEspecialidad(especialidad)
  if (!e) return ''

  const known: Record<string, string> = {
    Odontología: 'odontologo',
    Neurología: 'neurologo',
    Cardiología: 'cardiologo',
    Dermatología: 'dermatologo',
    Ginecología: 'ginecologo',
    Pediatría: 'pediatra',
    Traumatología: 'traumatologo',
    Anestesiología: 'anestesiologo',
    Endocrinología: 'endocrinologo',
    Gastroenterología: 'gastroenterologo',
    Hematología: 'hematologo',
    Infectología: 'infectologo',
    Nefrología: 'nefrologo',
    Neumonología: 'neumonologo',
    Obstetricia: 'obstetra',
    Oftalmología: 'oftalmologo',
    Oncología: 'oncologo',
    Otorrinolaringología: 'otorrinolaringologo',
    Psiquiatría: 'psiquiatra',
    Radiología: 'radiologo',
    Reumatología: 'reumatologo',
    Urología: 'urologo',
    Diabetología: 'diabetologo',
    Kinesiología: 'kinesiologo',
    'Cirugía general': 'cirujano',
    'Clínica médica': 'clinico',
    'Medicina general': 'medico general',
  }

  const key = especialidadKey(e)
  for (const [label, nombre] of Object.entries(known)) {
    if (especialidadKey(label) === key) return nombre
  }

  const sinTildes = e.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (sinTildes.endsWith('ologia')) {
    return `${sinTildes.slice(0, -2)}o`
  }
  if (sinTildes.endsWith('iatria')) {
    return `${sinTildes.slice(0, -1)}a`
  }

  return sinTildes
}

/** Profesión para el texto «con el odontologo» a partir de la especialidad del médico. */
export function profesionalWhatsAppLabel(especialidad: string): string {
  const nombre = especialidadWhatsAppNombre(especialidad)
  if (!nombre) return 'el/la profesional'
  return `el ${nombre}`
}

export function buildTurnoReminderMessage(params: {
  fechaTurno: Date
  hora?: string
  especialidad: string
  medicoApellido: string
  medicoNombre: string
  medicoTitulo?: string
  saludo?: string
}): string {
  const {
    fechaTurno,
    hora,
    especialidad,
    medicoApellido,
    medicoNombre,
    saludo = saludoWhatsApp(),
  } = params

  const diaSemana = format(fechaTurno, 'EEEE', { locale: es }).toLowerCase()
  const fechaNum = format(fechaTurno, 'dd/MM', { locale: es })
  const horaText = hora?.trim() ? `, a las ${hora.trim()} hs` : ''
  const profesional = profesionalWhatsAppLabel(especialidad)
  const medico = `${medicoApellido} ${medicoNombre}`.trim()

  return `${saludo}. Le recordamos su turno mañana, ${diaSemana} ${fechaNum}${horaText} con ${profesional} ${medico}.

Por favor, confirme su asistencia. ¡Muchas gracias!

CUIDAR CENTRO MÉDICO`
}

/** Recordatorio WhatsApp a partir del turno y médico de la agenda. */
export function buildTurnoReminderMessageFromCita(params: {
  fechaHoraIso: string
  hora?: string
  especialidad?: string
  medicoApellido?: string
  medicoNombre?: string
  medicoTitulo?: string
  saludo?: string
}): string {
  const hora = params.hora || format(parseISO(params.fechaHoraIso), 'HH:mm')
  return buildTurnoReminderMessage({
    fechaTurno: fechaCalendarioTurnoAgenda(params.fechaHoraIso),
    hora,
    especialidad: params.especialidad ?? '',
    medicoApellido: params.medicoApellido ?? '—',
    medicoNombre: params.medicoNombre ?? '',
    medicoTitulo: params.medicoTitulo,
    saludo: params.saludo,
  })
}

export function formatTurnoFechaReprogramacionOriginal(fecha: Date): string {
  const dia = format(fecha, 'EEEE', { locale: es })
  const diaCap = dia.charAt(0).toUpperCase() + dia.slice(1)
  const fechaNum = format(fecha, 'dd/MM', { locale: es })
  return `${diaCap} ${fechaNum}`
}

export function formatTurnoFechaReprogramacionNueva(fecha: Date): string {
  const dia = format(fecha, 'EEEE', { locale: es })
  const diaCap = dia.charAt(0).toUpperCase() + dia.slice(1)
  const fechaNum = format(fecha, 'dd-MM', { locale: es })
  return `${diaCap} ${fechaNum}`
}

export function formatTurnoHoraReprogramacion(hora: string): string {
  const [h = '00', m = '00'] = hora.split(':')
  return `${h}.${m} hs`
}

function conArticuloMedicoReprogramacion(titulo: string): 'Con el' | 'Con la' {
  const t = titulo.replace(/\./g, '').trim().toLowerCase()
  return t === 'dr' ? 'Con el' : 'Con la'
}

export function buildTurnoReprogramacionMessage(params: {
  fechaTurnoOriginal: Date
  medicoApellido: string
  medicoNombre: string
  horaNueva: string
  /** Si no se indica, se propone la misma semana siguiente. */
  fechaTurnoNueva?: Date
  medicoTitulo?: string
  saludo?: string
}): string {
  const {
    fechaTurnoOriginal,
    fechaTurnoNueva,
    horaNueva,
    medicoApellido,
    medicoNombre,
    medicoTitulo = 'Dr.',
    saludo = saludoWhatsApp(),
  } = params
  const fechaOriginal = formatTurnoFechaReprogramacionOriginal(fechaTurnoOriginal)
  const fechaNueva = formatTurnoFechaReprogramacionNueva(
    fechaTurnoNueva ?? addWeeks(fechaTurnoOriginal, 1),
  )
  const horaLabel = formatTurnoHoraReprogramacion(horaNueva)
  const medico = `${medicoTitulo} ${medicoApellido} ${medicoNombre}`.trim()
  const conMedico = conArticuloMedicoReprogramacion(medicoTitulo)
  return `${saludo} . Soy del Centro Médico Cuidar
Te escribo para avisarte que por  fuerza mayor se reprogramara el turno del día ${fechaOriginal}  . ${conMedico} ${medico} . Trasladándose  al día ${fechaNueva}  horario de las ${horaLabel}
Quedamos atentos a su confirmación de Horario para así poder agendarlo.
Desde ya mil disculpas por las molestias ocasionadas y aguardamos información.`
}

/** Marca el turno al abrir WhatsApp desde la app (aprox. recordatorio enviado). */
export function markWhatsAppRecordatorioEnviado(
  c: Appointment,
  when: Date = new Date(),
): Appointment {
  return { ...c, whatsappRecordatorioEnviadoEn: when.toISOString() }
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

let whatsappOpening = false

/** Abre la aplicación de WhatsApp de escritorio usando WebView de Tauri. */
export async function openWhatsAppUrl(
  telefono: string,
  mensaje: string,
): Promise<void> {
  if (whatsappOpening) {
    throw new Error('WhatsApp ya se está abriendo. Esperá un momento.')
  }

  const appUrl = buildWaMeUrl(telefono, mensaje)
  if (!appUrl) {
    throw new Error('Teléfono inválido para WhatsApp')
  }

  whatsappOpening = true
  try {
    if (!isTauri()) {
      window.location.href = appUrl
      return
    }

    await invoke('open_whatsapp_url', { url: appUrl })
  } finally {
    whatsappOpening = false
  }
}

/** Abre WhatsApp Web en el navegador con el mensaje preparado. */
export async function openWhatsAppWebUrl(
  telefono: string,
  mensaje: string,
): Promise<void> {
  if (whatsappOpening) {
    throw new Error('WhatsApp ya se está abriendo. Esperá un momento.')
  }

  // Intentamos normalizar el teléfono primero, pero si fallamos todavía intentamos abrir
  // para que WhatsApp Web muestre su propio error de formato inválido
  let webUrl: string
  const normalizedPhone = normalizePhoneForWhatsApp(telefono)
  if (normalizedPhone !== null) {
    webUrl = `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(mensaje)}`
  } else {
    // Extraemos solo los dígitos como fallback para permitir que WhatsApp Web muestre su error
    const digitsOnly = telefono.replace(/\D/g, '')
    if (digitsOnly !== '') {
      webUrl = `https://web.whatsapp.com/send?phone=${digitsOnly}&text=${encodeURIComponent(mensaje)}`
    } else {
      // No hay ningún dígito en el teléfono, lanzamos error para que el llamador lo maneje
      throw new Error('Teléfono sin dígitos')
    }
  }

  whatsappOpening = true
  try {
    if (isTauri()) {
      // En Tauri: intenta primero la ventana propia de la app (comando abrir_whatsapp)
      const telNorm = normalizedPhone !== null ? normalizedPhone : (telefono.replace(/\D/g, ''))
      try {
        await invoke('abrir_whatsapp', { telefono: telNorm, mensaje })
        return
      } catch (e) {
        console.error('[WhatsApp] abrir_whatsapp falló, uso Chrome como respaldo:', e)
        alert('[WhatsApp] abrir_whatsapp falló: ' + (e instanceof Error ? e.message : String(e)))
      }
      // Fallback a Chrome si el comando falla
      try {
        await openUrl(webUrl, 'chrome.exe')
        console.log('[WhatsApp] Abierto en Chrome (chrome.exe)')
      } catch (e1) {
        console.warn('[WhatsApp] chrome.exe falló:', e1)
        try {
          await openUrl(webUrl, 'chrome')
          console.log('[WhatsApp] Abierto en Chrome (chrome)')
        } catch (e2) {
          console.warn('[WhatsApp] chrome falló:', e2)
          await openUrl(webUrl)
          console.log('[WhatsApp] Abierto en navegador predeterminado')
        }
      }
      return
    }

    // En navegador normal: intenta reutilizar pestaña con nombre fijo
    const newWindow = window.open(webUrl, 'whatsapp_web')
    if (!newWindow) {
      // Popup bloqueado, navega en la misma pestaña
      window.location.href = webUrl
    }
  } finally {
    whatsappOpening = false
  }
}

export type WhatsAppSecuencialItem = {
  tel: string
  mensaje: string
  nombre: string
}

/** Abre WhatsApp de a un paciente; pide confirmación antes de cada siguiente. */
export async function openWhatsAppSecuencial(params: {
  items: WhatsAppSecuencialItem[]
  confirm: (options: {
    title?: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
  }) => Promise<boolean>
  onItemSent?: (index: number, item: WhatsAppSecuencialItem) => void
  onItemError?: (item: WhatsAppSecuencialItem, err: unknown) => void
  open?: (telefono: string, mensaje: string) => Promise<void>
}): Promise<number> {
  const { items, confirm, onItemSent, onItemError, open = openWhatsAppUrl } = params
  let sent = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (i > 0) {
      const cont = await confirm({
        title: 'Siguiente paciente',
        message: `Mensaje ${i} de ${items.length} listo.\n\n¿Abrir WhatsApp para ${item.nombre}?`,
        confirmLabel: 'Siguiente',
        cancelLabel: 'Detener',
      })
      if (!cont) break
    }

    try {
      await open(item.tel, item.mensaje)
      onItemSent?.(i, item)
      sent++
    } catch (err) {
      onItemError?.(item, err)
      break
    }
  }

  return sent
}

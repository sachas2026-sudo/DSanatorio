export type AppShortcut = {
  keys: string
  label: string
  path?: string
  adminOnly?: boolean
}

export const ALT_NUMBER_ROUTES: Record<string, string> = {
  '1': '/',
  '2': '/pacientes',
  '3': '/medicos',
  '4': '/agenda',
  '5': '/pagos',
  '6': '/pagos-cancelados',
  '7': '/configuracion',
}

export const APP_SHORTCUTS: AppShortcut[] = [
  { keys: 'Alt+1', label: 'Inicio', path: '/' },
  { keys: 'Alt+2', label: 'Pacientes', path: '/pacientes' },
  { keys: 'Alt+3', label: 'Médicos', path: '/medicos' },
  { keys: 'Alt+4', label: 'Agenda', path: '/agenda' },
  { keys: 'Alt+5', label: 'Pagos', path: '/pagos' },
  {
    keys: 'Alt+6',
    label: 'Pagos cancelados',
    path: '/pagos-cancelados',
    adminOnly: true,
  },
  {
    keys: 'Alt+7',
    label: 'Configuración',
    path: '/configuracion',
    adminOnly: true,
  },
  { keys: 'F1', label: 'Ayuda (versión y atajos)' },
  { keys: '?', label: 'Ayuda (versión y atajos)' },
  { keys: 'Esc', label: 'Cerrar ventana o modal' },
]

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export function bindAppShortcuts(
  navigate: (path: string) => void,
  canAccessPath: (pathname: string) => boolean,
  onShowHelp: () => void,
): () => void {
  function onKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return

    if (e.key === 'F1') {
      e.preventDefault()
      onShowHelp()
      return
    }

    if (
      e.key === '?' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      e.preventDefault()
      onShowHelp()
      return
    }

    if (!e.altKey || e.ctrlKey || e.metaKey) return

    const path = ALT_NUMBER_ROUTES[e.key]
    if (!path || !canAccessPath(path)) return

    e.preventDefault()
    navigate(path)
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}

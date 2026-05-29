export type ChangelogEntry = {
  version: string
  date: string
  highlights: string[]
}

/** Novedades recientes (más reciente primero). */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.7',
    date: 'May 2026',
    highlights: [
      'Estabilidad: tests automatizados, respaldos diarios y validación al importar.',
      'Seguridad: contraseñas hasheadas y clave SMTP fuera del JSON.',
      'Pagos: dos formas de pago por turno (split pay).',
      'Roles: exportaciones sensibles y liquidación solo para administración.',
      'Agenda: columnas de médicos con ancho fijo y scroll horizontal.',
      'Producto: versión en barra lateral, atajos Alt+número y modal de ayuda (F1).',
      'Refactor: libs agendaDisplay/paymentInput/appStateLoad; pestañas config agenda; CSS pagos cancelados.',
    ],
  },
]

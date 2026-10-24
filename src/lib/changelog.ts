export type ChangelogEntry = {
  version: string
  date: string
  highlights: string[]
}

/** Novedades recientes (más reciente primero). */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date: 'May 2026',
    highlights: [
      'Calidad: CI (lint, tests, build), tests Rust de respaldos, versión unificada.',
      'Respaldos: rotación, diarios 60 días, companion (usuarios y claves), restauración en Configuración.',
      'Instalación en C:\\Sanatorio (app, datos y respaldos).',
      'Seguridad: contraseñas hasheadas; clave SMTP en archivo aparte del JSON.',
      'Pagos: dos formas de pago por turno (split pay); roles Admi / Secretaría.',
      'Agenda: columnas de médicos, PDF turnos, correo; pacientes/médicos suspendidos.',
      'Producto: versión en barra lateral, atajos Alt+número y ayuda F1.',
    ],
  },
]

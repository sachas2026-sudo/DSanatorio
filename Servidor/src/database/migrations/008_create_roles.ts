import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea el catálogo inicial de roles del servidor. */
export const createRolesMigration: Migration = {
  version: 8,
  name: '008_create_roles',
  description: 'Crea la tabla de roles y sus roles iniciales',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
        descripcion TEXT NOT NULL DEFAULT '',
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO roles (nombre, descripcion)
      VALUES
        ('Administrador', 'Acceso completo al sistema'),
        ('Recepción', 'Gestión de pacientes y turnos'),
        ('Médico', 'Acceso a la información clínica autorizada'),
        ('Caja', 'Gestión y consulta de pagos'),
        ('Invitado', 'Acceso de solo lectura');
    `)
  },
}

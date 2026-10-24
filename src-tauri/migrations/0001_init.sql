CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY NOT NULL,
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  dni TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  domicilio TEXT NOT NULL DEFAULT '',
  localidad TEXT NOT NULL DEFAULT '',
  fecha_nacimiento TEXT NOT NULL DEFAULT '',
  obra_social TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY NOT NULL,
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  dni TEXT NOT NULL DEFAULT '',
  matricula TEXT NOT NULL DEFAULT '',
  especialidad TEXT NOT NULL,
  obra_social TEXT NOT NULL DEFAULT '',
  obras_sociales_json TEXT NOT NULL DEFAULT '[]',
  telefono TEXT NOT NULL DEFAULT '',
  localidad TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL DEFAULT '',
  porcentaje REAL NOT NULL DEFAULT 0.0,
  duracion_turno_minutos INTEGER NOT NULL DEFAULT 30,
  tipo_agenda TEXT NOT NULL DEFAULT 'semanal',
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS horarios (
  id TEXT PRIMARY KEY NOT NULL,
  doctor_id TEXT NOT NULL,
  dia_semana INTEGER NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT NOT NULL,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dias_libres (
  id TEXT PRIMARY KEY NOT NULL,
  doctor_id TEXT NOT NULL,
  dia_semana INTEGER NOT NULL,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS atenciones_mensuales (
  id TEXT PRIMARY KEY NOT NULL,
  doctor_id TEXT NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT NOT NULL,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL,
  doctor_id TEXT NOT NULL,
  fecha_hora TEXT NOT NULL,
  duracion_minutos INTEGER NOT NULL DEFAULT 30,
  notas TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'programado',
  whatsapp_recordatorio_enviado_en TEXT,
  obra_social_override TEXT,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL,
  doctor_id TEXT NOT NULL,
  cita_id TEXT,
  monto REAL NOT NULL,
  fecha TEXT NOT NULL,
  metodo TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  porcentaje_aplicado REAL NOT NULL DEFAULT 0.0,
  obra_social_override TEXT,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (cita_id) REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS atenciones_sin_turno (
  id TEXT PRIMARY KEY NOT NULL,
  doctor_id TEXT NOT NULL,
  fecha TEXT NOT NULL,
  filas_json TEXT NOT NULL DEFAULT '[]',
  guardado_en TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pagos_cancelados (
  id TEXT PRIMARY KEY NOT NULL,
  motivo TEXT NOT NULL,
  cancelado_en TEXT NOT NULL,
  payment_json TEXT NOT NULL,
  appointment_json TEXT,
  notas_otros TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS especialidades_custom (
  name TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS obras_sociales_custom (
  name TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS localidades_custom (
  name TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS motivos_consulta_custom (
  name TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

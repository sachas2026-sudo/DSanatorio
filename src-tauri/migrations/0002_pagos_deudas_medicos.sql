CREATE TABLE IF NOT EXISTS pagos_deudas_medicos (
  id TEXT PRIMARY KEY NOT NULL,
  doctor_id TEXT NOT NULL,
  deuda_key TEXT NOT NULL,
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo TEXT NOT NULL DEFAULT '',
  nota TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

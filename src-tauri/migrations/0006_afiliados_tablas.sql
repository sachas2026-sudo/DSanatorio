CREATE TABLE IF NOT EXISTS afiliados (
  id TEXT PRIMARY KEY,
  nombre TEXT,
  version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS planes_afiliados (
  id TEXT PRIMARY KEY,
  nombre TEXT,
  version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cuotas_afiliados (
  id TEXT PRIMARY KEY,
  monto REAL,
  version INTEGER DEFAULT 1
);

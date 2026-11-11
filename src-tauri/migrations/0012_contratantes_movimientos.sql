ALTER TABLE patients ADD COLUMN obra_social_anterior TEXT;

CREATE TABLE IF NOT EXISTS contratante_movimientos (
    id TEXT PRIMARY KEY,
    afiliado_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    fecha TEXT NOT NULL,
    detalle TEXT NOT NULL,
    motivo TEXT,
    usuario TEXT NOT NULL DEFAULT '',
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    data TEXT
);

CREATE INDEX IF NOT EXISTS idx_contratante_movimientos_afiliado
    ON contratante_movimientos(afiliado_id, fecha DESC);


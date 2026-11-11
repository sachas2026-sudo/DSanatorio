-- 0010_obras_sociales_catalogo.sql
CREATE TABLE IF NOT EXISTS obras_sociales (
    nombre TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
    plus INTEGER NOT NULL DEFAULT 0,
    arancel INTEGER NOT NULL DEFAULT 0,
    cuidar INTEGER NOT NULL DEFAULT 0,
    imp_banco INTEGER NOT NULL DEFAULT 0,
    imp_factura INTEGER NOT NULL DEFAULT 0,
    gastos_adm INTEGER NOT NULL DEFAULT 0,
    suspendida INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1
);

-- Sembrar los 12 habituales
INSERT OR IGNORE INTO obras_sociales (nombre) VALUES
    ('IPS'),
    ('PAMI'),
    ('OSDE'),
    ('Swiss Medical'),
    ('Galeno'),
    ('IOMA'),
    ('OMINT'),
    ('Medicus'),
    ('OSECAC'),
    ('Sancor Salud'),
    ('Accord Salud'),
    ('Particular');

-- Migrar las agregadas existentes desde obras_sociales_custom si existe la tabla
INSERT OR IGNORE INTO obras_sociales (nombre)
SELECT name FROM obras_sociales_custom WHERE name IS NOT NULL AND TRIM(name) != '';


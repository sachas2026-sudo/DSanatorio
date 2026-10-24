ALTER TABLE pagos_deudas_medicos ADD COLUMN destinatario TEXT NOT NULL DEFAULT 'Gerencia';
ALTER TABLE pagos_deudas_medicos ADD COLUMN nro_comprobante TEXT NOT NULL DEFAULT '';
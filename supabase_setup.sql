-- ==============================================================================
-- CUIDAR CENTRO MÉDICO - TABLA DE RESUMEN DIARIO PARA CELULAR (SUPABASE)
-- ==============================================================================
-- Copiar y pegar este código en el "SQL Editor" de tu panel de Supabase y darle a "Run".

CREATE TABLE IF NOT EXISTS public.resumen_diario (
  fecha DATE PRIMARY KEY,
  total_cobrado NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_centro NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_medicos NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_efectivo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_transferencia NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_otros NUMERIC(12, 2) NOT NULL DEFAULT 0,
  turnos_totales INTEGER NOT NULL DEFAULT 0,
  turnos_atendidos INTEGER NOT NULL DEFAULT 0,
  turnos_cancelados INTEGER NOT NULL DEFAULT 0,
  turnos_pendientes INTEGER NOT NULL DEFAULT 0,
  recaudacion_manana NUMERIC(12, 2) NOT NULL DEFAULT 0,
  recaudacion_tarde NUMERIC(12, 2) NOT NULL DEFAULT 0,
  recaudacion_mary NUMERIC(12, 2) NOT NULL DEFAULT 0,
  recaudacion_andrea NUMERIC(12, 2) NOT NULL DEFAULT 0,
  medicos_detalle JSONB NOT NULL DEFAULT '[]'::jsonb,
  ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origen TEXT DEFAULT 'Sanatorio Desktop'
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.resumen_diario ENABLE ROW LEVEL SECURITY;

-- Política de lectura para la App del Celular (usando anon key)
CREATE POLICY "Permitir lectura publica resumen_diario"
  ON public.resumen_diario
  FOR SELECT
  TO anon
  USING (true);

-- Política de inserción y actualización para la sincronización desde el Sanatorio
CREATE POLICY "Permitir insercion resumen_diario"
  ON public.resumen_diario
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Permitir actualizacion resumen_diario"
  ON public.resumen_diario
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Índice para consultas rápidas por fecha
CREATE INDEX IF NOT EXISTS idx_resumen_diario_fecha ON public.resumen_diario (fecha DESC);

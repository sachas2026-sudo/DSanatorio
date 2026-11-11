CREATE TABLE IF NOT EXISTS public.resumen_diario (
  fecha DATE PRIMARY KEY,
  total_cobrado NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_centro NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_medicos NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_transferencia NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_otros NUMERIC(12,2) NOT NULL DEFAULT 0,
  turnos_totales INTEGER NOT NULL DEFAULT 0,
  turnos_atendidos INTEGER NOT NULL DEFAULT 0,
  turnos_cancelados INTEGER NOT NULL DEFAULT 0,
  turnos_pendientes INTEGER NOT NULL DEFAULT 0,
  recaudacion_manana NUMERIC(12,2) NOT NULL DEFAULT 0,
  recaudacion_tarde NUMERIC(12,2) NOT NULL DEFAULT 0,
  recaudacion_mary NUMERIC(12,2) NOT NULL DEFAULT 0,
  recaudacion_andrea NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- formato: [{"nombre":"Dr. Gómez, Juan","pacientes":8,"monto":96000}]
  medicos_detalle JSONB NOT NULL DEFAULT '''[]'''::jsonb
    CHECK (jsonb_typeof(medicos_detalle) = '''array'''),
  turnos_clasificacion JSONB NOT NULL DEFAULT '''{}'''::jsonb
    CHECK (jsonb_typeof(turnos_clasificacion) = '''object'''),
  ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origen TEXT DEFAULT 'Sanatorio Desktop'
);

ALTER TABLE public.resumen_diario ENABLE ROW LEVEL SECURITY;

-- Limpiar politicas previas si existen
DROP POLICY IF EXISTS "Permitir lectura publica resumen_diario" ON public.resumen_diario;
DROP POLICY IF EXISTS "lectura_resumen_diario" ON public.resumen_diario;
DROP POLICY IF EXISTS "insercion_resumen_diario" ON public.resumen_diario;
DROP POLICY IF EXISTS "actualizacion_resumen_diario" ON public.resumen_diario;
DROP POLICY IF EXISTS "lectura_admin_resumen_diario" ON public.resumen_diario;

-- Solo lectura para usuarios autenticados con rol admin
CREATE POLICY "lectura_admin_resumen_diario"
  ON public.resumen_diario FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');

CREATE INDEX IF NOT EXISTS idx_resumen_diario_fecha
  ON public.resumen_diario (fecha DESC);


ALTER TABLE public.resumen_diario
  ADD COLUMN IF NOT EXISTS turnos_clasificacion JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(turnos_clasificacion) = 'object');

CREATE OR REPLACE FUNCTION public.resumen_periodo(p_desde date, p_hasta date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH r AS (
    SELECT * FROM public.resumen_diario WHERE fecha BETWEEN p_desde AND p_hasta
  ),
  m AS (
    SELECT d->>'nombre' AS nombre,
           SUM((d->>'pacientes')::int) AS pacientes,
           SUM((d->>'monto')::numeric) AS monto
    FROM r, jsonb_array_elements(r.medicos_detalle) d
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'dias', count(*),
    'total_cobrado', COALESCE(sum(total_cobrado),0),
    'total_centro', COALESCE(sum(total_centro),0),
    'total_medicos', COALESCE(sum(total_medicos),0),
    'total_efectivo', COALESCE(sum(total_efectivo),0),
    'total_transferencia', COALESCE(sum(total_transferencia),0),
    'total_otros', COALESCE(sum(total_otros),0),
    'turnos_totales', COALESCE(sum(turnos_totales),0),
    'turnos_atendidos', COALESCE(sum(turnos_atendidos),0),
    'turnos_cancelados', COALESCE(sum(turnos_cancelados),0),
    'turnos_pendientes', COALESCE(sum(turnos_pendientes),0),
    'recaudacion_manana', COALESCE(sum(recaudacion_manana),0),
    'recaudacion_tarde', COALESCE(sum(recaudacion_tarde),0),
    'ultima_actualizacion', max(ultima_actualizacion),
    'clasificacion', jsonb_build_object(
      'atendidos', jsonb_build_object(
        'obra_social', COALESCE(sum((turnos_clasificacion->'atendidos'->>'obra_social')::int),0),
        'individual',  COALESCE(sum((turnos_clasificacion->'atendidos'->>'individual')::int),0),
        'familiar',    COALESCE(sum((turnos_clasificacion->'atendidos'->>'familiar')::int),0),
        'plan_plus',   COALESCE(sum((turnos_clasificacion->'atendidos'->>'plan_plus')::int),0),
        'particular',  COALESCE(sum((turnos_clasificacion->'atendidos'->>'particular')::int),0)),
      'pendientes', jsonb_build_object(
        'obra_social', COALESCE(sum((turnos_clasificacion->'pendientes'->>'obra_social')::int),0),
        'individual',  COALESCE(sum((turnos_clasificacion->'pendientes'->>'individual')::int),0),
        'familiar',    COALESCE(sum((turnos_clasificacion->'pendientes'->>'familiar')::int),0),
        'plan_plus',   COALESCE(sum((turnos_clasificacion->'pendientes'->>'plan_plus')::int),0),
        'particular',  COALESCE(sum((turnos_clasificacion->'pendientes'->>'particular')::int),0)),
      'cancelados', jsonb_build_object(
        'obra_social', COALESCE(sum((turnos_clasificacion->'cancelados'->>'obra_social')::int),0),
        'individual',  COALESCE(sum((turnos_clasificacion->'cancelados'->>'individual')::int),0),
        'familiar',    COALESCE(sum((turnos_clasificacion->'cancelados'->>'familiar')::int),0),
        'plan_plus',   COALESCE(sum((turnos_clasificacion->'cancelados'->>'plan_plus')::int),0),
        'particular',  COALESCE(sum((turnos_clasificacion->'cancelados'->>'particular')::int),0))),
    'medicos', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'nombre', nombre, 'pacientes', pacientes, 'monto', monto)
        ORDER BY monto DESC), '[]'::jsonb) FROM m)
  ) FROM r;
$$;

-- Actualización en vivo en el celular (opcional)
ALTER PUBLICATION supabase_realtime ADD TABLE public.resumen_diario;

-- ============================================================================
-- TABLA: medicos_directorio
-- Directorio general de médicos del centro, su especialidad y porcentaje.
-- RLS activado: Solo lectura para authenticated con rol admin. Sin escritura para clientes.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.medicos_directorio (
  medico_id TEXT PRIMARY KEY,              -- id del médico en la base de escritorio
  nombre TEXT NOT NULL,                    -- "Dr. Gómez, Juan"
  especialidad TEXT NOT NULL DEFAULT 'Sin especialidad',
  porcentaje_medico NUMERIC(5,2) NOT NULL
    CHECK (porcentaje_medico >= 0 AND porcentaje_medico <= 100),  -- lo que recibe el médico; el resto es del centro
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.medicos_directorio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lectura_admin_medicos_directorio" ON public.medicos_directorio;
DROP POLICY IF EXISTS "lectura_publica_medicos_directorio" ON public.medicos_directorio;

-- Lectura para usuarios autenticados y app móvil con clave anon
CREATE POLICY "lectura_publica_medicos_directorio"
  ON public.medicos_directorio FOR SELECT TO anon, authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_medicos_directorio_nombre
  ON public.medicos_directorio (nombre);

ALTER PUBLICATION supabase_realtime ADD TABLE public.medicos_directorio;


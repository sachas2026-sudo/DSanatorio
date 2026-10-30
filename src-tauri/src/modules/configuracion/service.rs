use std::fs;
use std::path::PathBuf;
use rusqlite::{Connection, Transaction, TransactionBehavior};
use tauri::Manager;
use crate::core::error::AppError;
use crate::core::db;
use crate::core::config::settings;
use super::dto::*;
use super::repository;

pub struct InstanceLock {
    #[cfg(windows)]
    _file: Option<std::fs::File>,
}

pub fn try_acquire_single_instance_lock(
    _app: &tauri::AppHandle,
) -> Result<InstanceLock, String> {
    use std::fs::OpenOptions;

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        const ERROR_SHARING_VIOLATION: i32 = 32;

        let dir = settings::data_dir();
        let _ = fs::create_dir_all(&dir);
        let lock_path = dir.join("sanatorio.lock");
        match OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .share_mode(0)
            .open(&lock_path)
        {
            Ok(file) => Ok(InstanceLock { _file: Some(file) }),
            Err(err) if err.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => Err(
                "Ya hay otra ventana de Sanatorio abierta.\nCierre la otra antes de volver a abrir."
                    .into(),
            ),
            Err(err) => Err(format!("No se pudo bloquear instancia única: {err}")),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(InstanceLock {})
    }
}

pub fn ensure_initialized() -> Result<(), AppError> {
    let db_path = db::db_file_path()?;
    let json_path = db::json_export_path()?;

    // Si la base de datos no existe y el JSON legacy existe, realizamos la migración automática
    if !db_path.is_file() && json_path.is_file() {
        let raw = fs::read_to_string(&json_path)?;
        if !raw.trim().is_empty() {
            match serde_json::from_str::<AppData>(&raw) {
                Ok(data) => {
                    // Inicializar la conexión (crea el archivo y corre migraciones init)
                    let _conn = db::open_connection()?;
                    
                    // Guardar los datos en SQLite
                    save_app_data_direct(&data)?;
                    
                    // Renombrar el JSON original a .migrado para marcar el éxito
                    let migrated_path = json_path.with_extension("json.migrado");
                    fs::rename(&json_path, &migrated_path)?;
                    
                    println!("[Sanatorio] Migración de datos JSON a SQLite completada con éxito.");
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("[Sanatorio] Error al parsear JSON legacy para migración: {e}");
                }
            }
        }
    }

    // Inicializar conexión normal si no hay migración
    let _conn = db::open_connection()?;
    Ok(())
}

pub fn load_app_data() -> Result<AppData, AppError> {
    let conn = db::open_connection()?;

    let patients = repository::load_patients(&conn)?;
    let doctors = repository::load_doctors(&conn)?;
    let horarios = repository::load_horarios(&conn)?;
    let dias_libres = repository::load_dias_libres(&conn)?;
    let atenciones_mensuales = repository::load_atenciones_mensuales(&conn)?;
    let appointments = repository::load_appointments(&conn)?;
    let payments = repository::load_payments(&conn)?;
    let atenciones_sin_turno = repository::load_atenciones_sin_turno(&conn)?;
    let pagos_cancelados = repository::load_pagos_cancelados(&conn)?;
    let pagos_deudas_medicos = repository::load_pagos_deudas_medicos(&conn)?;
    
    let especialidades_custom = repository::load_custom_list(&conn, "especialidades_custom")?;
    let obras_sociales_custom = repository::load_custom_list(&conn, "obras_sociales_custom")?;
    let localidades_custom = repository::load_custom_list(&conn, "localidades_custom")?;
    let motivos_consulta_custom = repository::load_custom_list(&conn, "motivos_consulta_custom")?;
    
    let settings = repository::load_settings(&conn)?;

    let afiliados = repository::load_afiliados_table(&conn).unwrap_or_else(|_| repository::load_app_module(&conn, "afiliados").unwrap_or_default());
    let planes_afiliados = repository::load_planes_table(&conn).unwrap_or_else(|_| repository::load_app_module(&conn, "planes_afiliados").unwrap_or_default());
    let cuotas_afiliados = repository::load_cuotas_table(&conn).unwrap_or_else(|_| repository::load_app_module(&conn, "cuotas_afiliados").unwrap_or_default());
    let distribucion_os_percentajes = repository::load_app_module(&conn, "distribucion_os_percentajes")?;

    Ok(AppData {
        patients,
        doctors,
        horarios,
        dias_libres,
        atenciones_mensuales,
        appointments,
        payments,
        atenciones_sin_turno,
        pagos_cancelados,
        pagos_deudas_medicos,
        especialidades_custom,
        obras_sociales_custom,
        localidades_custom,
        motivos_consulta_custom,
        settings,
        afiliados: Some(afiliados),
        planes_afiliados: Some(planes_afiliados),
        cuotas_afiliados: Some(cuotas_afiliados),
        distribucion_os_percentajes: Some(distribucion_os_percentajes),
    })
}

pub fn save_app_data_direct(data: &AppData) -> Result<(), AppError> {
    save_app_data_with_mode(data, false)
}

/// Reemplaza todos los datos durante una restauración. Se limpian primero las
/// tablas dependientes para que las copias antiguas no choquen con las claves
/// foráneas de la base actual.
pub fn replace_app_data_direct(data: &AppData) -> Result<(), AppError> {
    save_app_data_with_mode(data, true)
}

/// Guarda un afiliado por registro con control de versión.
pub fn save_afiliado(afiliado: &Afiliado) -> Result<WriteResult, AppError> {
    let mut conn = db::open_connection()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let result = repository::save_afiliado(&tx, afiliado)?;
    tx.commit()?;
    Ok(result)
}

/// Guarda un plan de afiliado por registro con control de versión.
pub fn save_plan_afiliado(plan: &PlanAfiliado) -> Result<WriteResult, AppError> {
    let mut conn = db::open_connection()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let result = repository::save_plan_afiliado(&tx, plan)?;
    tx.commit()?;
    Ok(result)
}

/// Guarda una cuota de afiliado por registro con control de versión.
pub fn save_cuota_afiliado(cuota: &CuotaAfiliado) -> Result<WriteResult, AppError> {
    let mut conn = db::open_connection()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let result = repository::save_cuota_afiliado(&tx, cuota)?;
    tx.commit()?;
    Ok(result)
}

fn save_app_data_with_mode(data: &AppData, replace_all: bool) -> Result<(), AppError> {
    let mut conn = db::open_connection()?;

    // Preservar módulos si la versión anterior no los envía (None).
    let afiliados_to_save = match &data.afiliados {
        Some(v) => v.clone(),
        None => repository::load_app_module(&conn, "afiliados").unwrap_or_default(),
    };
    let planes_to_save = match &data.planes_afiliados {
        Some(v) => v.clone(),
        None => repository::load_app_module(&conn, "planes_afiliados").unwrap_or_default(),
    };
    let cuotas_to_save = match &data.cuotas_afiliados {
        Some(v) => v.clone(),
        None => repository::load_app_module(&conn, "cuotas_afiliados").unwrap_or_default(),
    };
    let distribucion_to_save = match &data.distribucion_os_percentajes {
        Some(v) => v.clone(),
        None => repository::load_app_module(&conn, "distribucion_os_percentajes").unwrap_or_default(),
    };

    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

    if replace_all {
        tx.execute_batch(
            "DELETE FROM payments;
             DELETE FROM appointments;
             DELETE FROM atenciones_sin_turno;
             DELETE FROM pagos_deudas_medicos;
             DELETE FROM horarios;
             DELETE FROM dias_libres;
             DELETE FROM atenciones_mensuales;
             DELETE FROM pagos_cancelados;
             DELETE FROM patients WHERE deleted_at IS NULL;
             DELETE FROM doctors;
             DELETE FROM especialidades_custom;
             DELETE FROM obras_sociales_custom;
             DELETE FROM localidades_custom;
             DELETE FROM motivos_consulta_custom;
             DELETE FROM app_settings;
             DELETE FROM app_modules;"
        )?;
    }

    repository::save_patients(&tx, &data.patients)?;
    if !replace_all {
        // BAJA LÓGICA: Los pacientes que la UI ya no envía se marcan con deleted_at.
        let patient_ids: Vec<String> = data.patients.iter().map(|p| p.id.clone()).collect();
        let placeholders = patient_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!("UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id NOT IN ({}) AND deleted_at IS NULL", placeholders);
        tx.execute(&query, rusqlite::params_from_iter(patient_ids))?;
    }

    // Limpiar huérfanos de tablas con FK ANTES de reinsertar, para no violar
    // foreign_keys con doctor_id / patient_id inexistentes en la copia real.
    if !replace_all {
        let doctor_ids: Vec<String> = data.doctors.iter().map(|d| d.id.clone()).collect();
        let horario_ids: Vec<String> = data.horarios.iter().map(|h| h.id.clone()).collect();
        let dia_libre_ids: Vec<String> = data.dias_libres.iter().map(|d| d.id.clone()).collect();
        let atencion_mensual_ids: Vec<String> = data.atenciones_mensuales.iter().map(|a| a.id.clone()).collect();
        let appt_ids: Vec<String> = data.appointments.iter().map(|a| a.id.clone()).collect();
        let payment_ids: Vec<String> = data.payments.iter().map(|p| p.id.clone()).collect();
        let sin_turno_ids: Vec<String> = data.atenciones_sin_turno.iter().map(|l| l.id.clone()).collect();
        let pago_cancelado_ids: Vec<String> = data.pagos_cancelados.iter().map(|p| p.id.clone()).collect();
        let deuda_pago_ids: Vec<String> = data
            .pagos_deudas_medicos
            .iter()
            .map(|p| p.id.clone())
            .collect();

        db::delete_orphans(&tx, "doctors", "id", &doctor_ids)?;
        db::delete_orphans(&tx, "horarios", "id", &horario_ids)?;
        db::delete_orphans(&tx, "dias_libres", "id", &dia_libre_ids)?;
        db::delete_orphans(&tx, "atenciones_mensuales", "id", &atencion_mensual_ids)?;
        db::delete_orphans(&tx, "appointments", "id", &appt_ids)?;
        db::delete_orphans(&tx, "payments", "id", &payment_ids)?;
        db::delete_orphans(&tx, "atenciones_sin_turno", "id", &sin_turno_ids)?;
        db::delete_orphans(&tx, "pagos_cancelados", "id", &pago_cancelado_ids)?;
        db::delete_orphans(&tx, "pagos_deudas_medicos", "id", &deuda_pago_ids)?;
    }

    repository::save_doctors(&tx, &data.doctors)?;
    repository::save_horarios(&tx, &data.horarios)?;
    repository::save_dias_libres(&tx, &data.dias_libres)?;
    repository::save_atenciones_mensuales(&tx, &data.atenciones_mensuales)?;
    repository::save_appointments(&tx, &data.appointments)?;
    repository::save_payments(&tx, &data.payments)?;
    repository::save_atenciones_sin_turno(&tx, &data.atenciones_sin_turno)?;
    repository::save_pagos_cancelados(&tx, &data.pagos_cancelados)?;
    repository::save_pagos_deudas_medicos(&tx, &data.pagos_deudas_medicos)?;

    // Para las listas custom, simplemente limpiamos y volvemos a insertar
    if !replace_all { tx.execute("DELETE FROM especialidades_custom", [])?; }
    repository::save_custom_list(&tx, "especialidades_custom", &data.especialidades_custom)?;

    if !replace_all { tx.execute("DELETE FROM obras_sociales_custom", [])?; }
    repository::save_custom_list(&tx, "obras_sociales_custom", &data.obras_sociales_custom)?;

    if !replace_all { tx.execute("DELETE FROM localidades_custom", [])?; }
    repository::save_custom_list(&tx, "localidades_custom", &data.localidades_custom)?;

    if !replace_all { tx.execute("DELETE FROM motivos_consulta_custom", [])?; }
    repository::save_custom_list(&tx, "motivos_consulta_custom", &data.motivos_consulta_custom)?;

    repository::save_settings(&tx, &data.settings)?;

    repository::save_afiliados_table(&tx, &afiliados_to_save)?;
    repository::save_planes_table(&tx, &planes_to_save)?;
    repository::save_cuotas_table(&tx, &cuotas_to_save)?;
    repository::save_app_module(&tx, "distribucion_os_percentajes", &distribucion_to_save)?;

    tx.commit()?;
    Ok(())
}

pub fn save_app_data(json_str: &str) -> Result<(), AppError> {
    let data: AppData = serde_json::from_str(json_str)?;
    // El frontend guarda el estado completo. Reemplazarlo en una transacción
    // evita que una restauración reciente choque con filas de la base anterior.
    replace_app_data_direct(&data)?;
    Ok(())
}

/// Devuelve el estado de write_enabled desde app_settings.
pub fn get_write_enabled(conn: &Connection) -> Result<bool, AppError> {
    let settings = repository::load_settings(conn)?;
    Ok(settings.write_enabled.unwrap_or(false))
}

/// Establece write_enabled en app_settings (dentro de una transacción).
pub fn set_write_enabled(tx: &Transaction<'_>, enabled: bool) -> Result<(), AppError> {
    let mut settings = repository::load_settings_from_tx(tx)?;
    settings.write_enabled = Some(enabled);
    repository::save_settings(tx, &settings)?;
    Ok(())
}

/// Escribe una entrada de auditoría.
pub fn write_audit_log(
    tx: &Transaction<'_>,
    usuario: &str,
    rol: &str,
    accion: &str,
    entidad: &str,
    entidad_id: Option<&str>,
    detalle: Option<&str>,
) -> Result<(), AppError> {
    repository::write_audit_log(tx, usuario, rol, accion, entidad, entidad_id, detalle)
}

/// Carga el log de auditoría completo.
pub fn load_audit_log(conn: &Connection) -> Result<Vec<AuditLogEntry>, AppError> {
    repository::load_audit_log(conn)
}

fn bundled_resource_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(r) = app.path().resource_dir() {
        roots.push(r);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("resources"));
            roots.push(dir.to_path_buf());
        }
    }
    roots
}

fn bundled_resource_file(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    bundled_resource_roots(app)
        .into_iter()
        .map(|root| root.join(name))
        .find(|path| path.is_file())
}

pub fn prepare_storage_on_startup(app: &tauri::AppHandle) {
    let data_dir = settings::data_dir();
    let _ = fs::create_dir_all(&data_dir);
    let json_path = data_dir.join("sanatorio-datos.json");
    let db_path = data_dir.join("sanatorio-datos.db");
    
    // Si no hay base de datos y no hay JSON, copiamos la base semilla si existe
    if !db_path.is_file() && !json_path.is_file() {
        if let Some(bundled) = bundled_resource_file(app, "sanatorio-datos.json") {
            let _ = fs::copy(&bundled, &json_path);
        }
    }

    // Copiar respaldos del instalador si es necesario
    let backup_names = ["sanatorio-datos.respaldo-1.json", "sanatorio-datos.respaldo-2.json", "sanatorio-datos.respaldo-3.json"];
    let backup_dirs = crate::modules::backups::service::backup_dirs_local_only();
    for name in backup_names {
        if let Some(bundled) = bundled_resource_file(app, name) {
            for dir in &backup_dirs {
                let dest = dir.join(name);
                if !dest.is_file() {
                    let _ = fs::copy(&bundled, &dest);
                }
            }
        }
    }

    if let Err(e) = ensure_initialized() {
        eprintln!("[Sanatorio] No se pudo inicializar SQLite: {e}");
    }
}

#[cfg(test)]
mod tests {
    include!("patient_tests.rs");
    include!("real_validation_ignored.rs");
    use super::*;
    use tempfile::TempDir;
}

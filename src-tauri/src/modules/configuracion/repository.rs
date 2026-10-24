use rusqlite::{params, Connection, Transaction};
use crate::core::error::AppError;
use super::dto::*;

pub fn load_patients(conn: &Connection) -> Result<Vec<Patient>, AppError> {
    let mut stmt = conn.prepare("SELECT id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo FROM patients")?;
    let rows = stmt.query_map([], |row| {
        Ok(Patient {
            id: row.get(0)?,
            nombre: row.get(1)?,
            apellido: row.get(2)?,
            dni: row.get(3)?,
            telefono: row.get(4)?,
            email: row.get(5)?,
            domicilio: row.get(6)?,
            localidad: row.get(7)?,
            fecha_nacimiento: row.get(8)?,
            obra_social: row.get(9)?,
            notas: row.get(10)?,
            activo: Some(row.get::<_, i32>(11)? != 0),
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_patients(tx: &Transaction<'_>, patients: &[Patient]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO patients (id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
    )?;

    for p in patients {
        let activo_val = if p.activo.unwrap_or(true) { 1 } else { 0 };
        stmt.execute(params![
            p.id,
            p.nombre,
            p.apellido,
            p.dni,
            p.telefono,
            p.email,
            p.domicilio,
            p.localidad,
            p.fecha_nacimiento,
            p.obra_social,
            p.notas,
            activo_val
        ])?;
    }
    Ok(())
}

pub fn load_doctors(conn: &Connection) -> Result<Vec<Doctor>, AppError> {
    let mut stmt = conn.prepare("SELECT id, nombre, apellido, dni, matricula, especialidad, obra_social, obras_sociales_json, telefono, localidad, email, alias, porcentaje, duracion_turno_minutos, tipo_agenda, activo FROM doctors")?;
    let rows = stmt.query_map([], |row| {
        let obras_sociales_json: String = row.get(7)?;
        let obras_sociales: Option<Vec<String>> = serde_json::from_str(&obras_sociales_json).ok();
        Ok(Doctor {
            id: row.get(0)?,
            nombre: row.get(1)?,
            apellido: row.get(2)?,
            dni: row.get(3)?,
            matricula: row.get(4)?,
            especialidad: row.get(5)?,
            obra_social: Some(row.get(6)?),
            obras_sociales,
            telefono: row.get(8)?,
            localidad: row.get(9)?,
            email: row.get(10)?,
            alias: Some(row.get(11)?),
            porcentaje: Some(row.get(12)?),
            duracion_turno_minutos: Some(row.get(13)?),
            tipo_agenda: Some(row.get(14)?),
            activo: Some(row.get::<_, i32>(15)? != 0),
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_doctors(tx: &Transaction<'_>, doctors: &[Doctor]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO doctors (id, nombre, apellido, dni, matricula, especialidad, obra_social, obras_sociales_json, telefono, localidad, email, alias, porcentaje, duracion_turno_minutos, tipo_agenda, activo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"
    )?;

    for d in doctors {
        let obras_json = serde_json::to_string(&d.obras_sociales.clone().unwrap_or_default()).unwrap_or_else(|_| "[]".to_string());
        let activo_val = if d.activo.unwrap_or(true) { 1 } else { 0 };
        stmt.execute(params![
            d.id,
            d.nombre,
            d.apellido,
            d.dni,
            d.matricula,
            d.especialidad,
            d.obra_social.clone().unwrap_or_default(),
            obras_json,
            d.telefono,
            d.localidad,
            d.email,
            d.alias.clone().unwrap_or_default(),
            d.porcentaje.unwrap_or(0.0),
            d.duracion_turno_minutos.unwrap_or(30),
            d.tipo_agenda.clone().unwrap_or_else(|| "semanal".to_string()),
            activo_val
        ])?;
    }
    Ok(())
}

pub fn load_horarios(conn: &Connection) -> Result<Vec<DoctorHorario>, AppError> {
    let mut stmt = conn.prepare("SELECT id, doctor_id, dia_semana, hora_inicio, hora_fin FROM horarios")?;
    let rows = stmt.query_map([], |row| {
        Ok(DoctorHorario {
            id: row.get(0)?,
            doctor_id: row.get(1)?,
            dia_semana: row.get(2)?,
            hora_inicio: row.get(3)?,
            hora_fin: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_horarios(tx: &Transaction<'_>, horarios: &[DoctorHorario]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO horarios (id, doctor_id, dia_semana, hora_inicio, hora_fin)
         VALUES (?1, ?2, ?3, ?4, ?5)"
    )?;

    for h in horarios {
        stmt.execute(params![h.id, h.doctor_id, h.dia_semana, h.hora_inicio, h.hora_fin])?;
    }
    Ok(())
}

pub fn load_dias_libres(conn: &Connection) -> Result<Vec<DoctorDiaLibre>, AppError> {
    let mut stmt = conn.prepare("SELECT id, doctor_id, dia_semana FROM dias_libres")?;
    let rows = stmt.query_map([], |row| {
        Ok(DoctorDiaLibre {
            id: row.get(0)?,
            doctor_id: row.get(1)?,
            dia_semana: row.get(2)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_dias_libres(tx: &Transaction<'_>, dias_libres: &[DoctorDiaLibre]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO dias_libres (id, doctor_id, dia_semana)
         VALUES (?1, ?2, ?3)"
    )?;

    for d in dias_libres {
        stmt.execute(params![d.id, d.doctor_id, d.dia_semana])?;
    }
    Ok(())
}

pub fn load_atenciones_mensuales(conn: &Connection) -> Result<Vec<DoctorAtencionMensual>, AppError> {
    let mut stmt = conn.prepare("SELECT id, doctor_id, fecha, hora_inicio, hora_fin FROM atenciones_mensuales")?;
    let rows = stmt.query_map([], |row| {
        Ok(DoctorAtencionMensual {
            id: row.get(0)?,
            doctor_id: row.get(1)?,
            fecha: row.get(2)?,
            hora_inicio: row.get(3)?,
            hora_fin: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_atenciones_mensuales(tx: &Transaction<'_>, atenciones: &[DoctorAtencionMensual]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO atenciones_mensuales (id, doctor_id, fecha, hora_inicio, hora_fin)
         VALUES (?1, ?2, ?3, ?4, ?5)"
    )?;

    for a in atenciones {
        stmt.execute(params![a.id, a.doctor_id, a.fecha, a.hora_inicio, a.hora_fin])?;
    }
    Ok(())
}

pub fn load_appointments(conn: &Connection) -> Result<Vec<Appointment>, AppError> {
    let mut stmt = conn.prepare("SELECT id, patient_id, doctor_id, fecha_hora, duracion_minutos, notas, estado, whatsapp_recordatorio_enviado_en, obra_social_override FROM appointments")?;
    let rows = stmt.query_map([], |row| {
        Ok(Appointment {
            id: row.get(0)?,
            patient_id: row.get(1)?,
            doctor_id: row.get(2)?,
            fecha_hora: row.get(3)?,
            duracion_minutos: row.get(4)?,
            notas: row.get(5)?,
            estado: row.get(6)?,
            whatsapp_recordatorio_enviado_en: row.get(7)?,
            obra_social_override: row.get(8)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_appointments(tx: &Transaction<'_>, appointments: &[Appointment]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO appointments (id, patient_id, doctor_id, fecha_hora, duracion_minutos, notas, estado, whatsapp_recordatorio_enviado_en, obra_social_override)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
    )?;

    for a in appointments {
        stmt.execute(params![
            a.id,
            a.patient_id,
            a.doctor_id,
            a.fecha_hora,
            a.duracion_minutos,
            a.notas,
            a.estado,
            a.whatsapp_recordatorio_enviado_en,
            a.obra_social_override
        ])?;
    }
    Ok(())
}

pub fn load_payments(conn: &Connection) -> Result<Vec<Payment>, AppError> {
    let mut stmt = conn.prepare("SELECT id, patient_id, doctor_id, cita_id, monto, fecha, metodo, notas, porcentaje_aplicado, obra_social_override FROM payments")?;
    let rows = stmt.query_map([], |row| {
        Ok(Payment {
            id: row.get(0)?,
            patient_id: row.get(1)?,
            doctor_id: row.get(2)?,
            cita_id: row.get(3)?,
            monto: row.get(4)?,
            fecha: row.get(5)?,
            metodo: row.get(6)?,
            notas: row.get(7)?,
            porcentaje_aplicado: Some(row.get(8)?),
            obra_social_override: row.get(9)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_payments(tx: &Transaction<'_>, payments: &[Payment]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO payments (id, patient_id, doctor_id, cita_id, monto, fecha, metodo, notas, porcentaje_aplicado, obra_social_override)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
    )?;

    for p in payments {
        stmt.execute(params![
            p.id,
            p.patient_id,
            p.doctor_id,
            p.cita_id,
            p.monto,
            p.fecha,
            p.metodo,
            p.notas,
            p.porcentaje_aplicado.unwrap_or(0.0),
            p.obra_social_override
        ])?;
    }
    Ok(())
}

pub fn load_atenciones_sin_turno(conn: &Connection) -> Result<Vec<AtencionSinTurnoListado>, AppError> {
    let mut stmt = conn.prepare("SELECT id, doctor_id, fecha, filas_json, guardado_en FROM atenciones_sin_turno")?;
    let rows = stmt.query_map([], |row| {
        let filas_json: String = row.get(3)?;
        let filas: Vec<AtencionSinTurnoFila> = serde_json::from_str(&filas_json).unwrap_or_default();
        Ok(AtencionSinTurnoListado {
            id: row.get(0)?,
            doctor_id: row.get(1)?,
            fecha: row.get(2)?,
            filas,
            guardado_en: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_atenciones_sin_turno(tx: &Transaction<'_>, listados: &[AtencionSinTurnoListado]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO atenciones_sin_turno (id, doctor_id, fecha, filas_json, guardado_en)
         VALUES (?1, ?2, ?3, ?4, ?5)"
    )?;

    for l in listados {
        let filas_json = serde_json::to_string(&l.filas).unwrap_or_else(|_| "[]".to_string());
        stmt.execute(params![l.id, l.doctor_id, l.fecha, filas_json, l.guardado_en])?;
    }
    Ok(())
}

pub fn load_pagos_cancelados(conn: &Connection) -> Result<Vec<PagoCancelado>, AppError> {
    let mut stmt = conn.prepare("SELECT id, motivo, cancelado_en, payment_json, appointment_json, notas_otros FROM pagos_cancelados")?;
    let rows = stmt.query_map([], |row| {
        let payment_json: String = row.get(3)?;
        let appointment_json: Option<String> = row.get(4)?;
        
        let payment: Payment = serde_json::from_str(&payment_json)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
            
        let appointment: Option<Appointment> = appointment_json
            .and_then(|j| serde_json::from_str(&j).ok());

        Ok(PagoCancelado {
            id: row.get(0)?,
            motivo: row.get(1)?,
            cancelado_en: row.get(2)?,
            payment,
            appointment,
            notas_otros: row.get(5)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_pagos_cancelados(tx: &Transaction<'_>, pagos: &[PagoCancelado]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO pagos_cancelados (id, motivo, cancelado_en, payment_json, appointment_json, notas_otros)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    )?;

    for p in pagos {
        let payment_json = serde_json::to_string(&p.payment).unwrap_or_else(|_| "{}".to_string());
        let appointment_json = p.appointment.as_ref().and_then(|a| serde_json::to_string(a).ok());
        stmt.execute(params![
            p.id,
            p.motivo,
            p.cancelado_en,
            payment_json,
            appointment_json,
            p.notas_otros
        ])?;
    }
    Ok(())
}

pub fn load_pagos_deudas_medicos(conn: &Connection) -> Result<Vec<DoctorDebtPayment>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, doctor_id, deuda_key, fecha, monto, metodo, destinatario, nro_comprobante, nota
         FROM pagos_deudas_medicos",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DoctorDebtPayment {
            id: row.get(0)?,
            doctor_id: row.get(1)?,
            deuda_key: row.get(2)?,
            fecha: row.get(3)?,
            monto: row.get(4)?,
            metodo: row.get(5)?,
            destinatario: row.get(6)?,
            nro_comprobante: row.get(7)?,
            nota: row.get(8)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn save_pagos_deudas_medicos(
    tx: &Transaction<'_>,
    pagos: &[DoctorDebtPayment],
) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO pagos_deudas_medicos
         (id, doctor_id, deuda_key, fecha, monto, metodo, destinatario, nro_comprobante, nota)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;

    for pago in pagos {
        stmt.execute(params![
            pago.id,
            pago.doctor_id,
            pago.deuda_key,
            pago.fecha,
            pago.monto,
            pago.metodo,
            pago.destinatario,
            pago.nro_comprobante,
            pago.nota,
        ])?;
    }
    Ok(())
}

pub fn load_custom_list(conn: &Connection, table: &str) -> Result<Vec<String>, AppError> {
    let query = format!("SELECT name FROM {}", table);
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_custom_list(tx: &Transaction<'_>, table: &str, items: &[String]) -> Result<(), AppError> {
    let query = format!("INSERT OR REPLACE INTO {} (name) VALUES (?1)", table);
    let mut stmt = tx.prepare(&query)?;
    for item in items {
        stmt.execute(params![item])?;
    }
    Ok(())
}

pub fn load_settings(conn: &Connection) -> Result<AppSettings, AppError> {
    let mut stmt = conn.prepare("SELECT key, value FROM app_settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    
    let mut settings = AppSettings::default();
    for r in rows {
        let (key, value) = r?;
        match key.as_str() {
            "email" => settings.email = value,
            "email_gerente" => settings.email_gerente = value,
            "telefono_gerente" => settings.telefono_gerente = value,
            "clave" => settings.clave = value,
            "telefono" => settings.telefono = value,
            "cuit" => settings.cuit = value,
            "carpeta_backup_google_drive" => {
                settings.carpeta_backup_google_drive = Some(value).filter(|s| !s.is_empty())
            }
            "carpeta_exportar_google_drive" => {
                settings.carpeta_exportar_google_drive = Some(value).filter(|s| !s.is_empty())
            }
            "carpeta_pdfs_google_drive" => {
                settings.carpeta_pdfs_google_drive = Some(value).filter(|s| !s.is_empty())
            }
            "ruta_google_drive_custom" => {
                settings.ruta_google_drive_custom = Some(value).filter(|s| !s.is_empty())
            }
            "google_drive_deshabilitado" => {
                settings.google_drive_deshabilitado = Some(value == "1" || value == "true");
            }
            "google_drive_setup_completado" => {
                settings.google_drive_setup_completado = Some(value == "1" || value == "true");
            }
            "secretaria_puede_modificar_mes_actual" => {
                settings.secretaria_puede_modificar_mes_actual = Some(value == "1" || value == "true");
            }
            "secretaria_puede_modificar_turnos_otros_usuarios" => {
                settings.secretaria_puede_modificar_turnos_otros_usuarios = Some(value == "1" || value == "true");
            }
            "mostrar_acciones_en_lista_pagos" | "mostrarAccionesEnListaPagos" => {
                settings.mostrar_acciones_en_lista_pagos = Some(value == "1" || value == "true");
            }
            _ => {}
        }
    }
    Ok(settings)
}

fn opt_str(value: &Option<String>) -> &str {
    value.as_deref().unwrap_or("")
}

fn opt_bool(value: &Option<bool>) -> &str {
    if value.unwrap_or(false) {
        "1"
    } else {
        "0"
    }
}

pub fn save_settings(tx: &Transaction<'_>, settings: &AppSettings) -> Result<(), AppError> {
    let mut stmt = tx.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)")?;
    stmt.execute(params!["email", settings.email])?;
    stmt.execute(params!["email_gerente", settings.email_gerente])?;
    stmt.execute(params!["telefono_gerente", settings.telefono_gerente])?;
    stmt.execute(params!["clave", settings.clave])?;
    stmt.execute(params!["telefono", settings.telefono])?;
    stmt.execute(params!["cuit", settings.cuit])?;
    stmt.execute(params![
        "carpeta_backup_google_drive",
        opt_str(&settings.carpeta_backup_google_drive)
    ])?;
    stmt.execute(params![
        "carpeta_exportar_google_drive",
        opt_str(&settings.carpeta_exportar_google_drive)
    ])?;
    stmt.execute(params![
        "carpeta_pdfs_google_drive",
        opt_str(&settings.carpeta_pdfs_google_drive)
    ])?;
    stmt.execute(params![
        "ruta_google_drive_custom",
        opt_str(&settings.ruta_google_drive_custom)
    ])?;
    stmt.execute(params![
        "google_drive_deshabilitado",
        opt_bool(&settings.google_drive_deshabilitado)
    ])?;
    stmt.execute(params![
        "google_drive_setup_completado",
        opt_bool(&settings.google_drive_setup_completado)
    ])?;
    stmt.execute(params![
        "secretaria_puede_modificar_mes_actual",
        opt_bool(&settings.secretaria_puede_modificar_mes_actual)
    ])?;
    stmt.execute(params![
        "secretaria_puede_modificar_turnos_otros_usuarios",
        opt_bool(&settings.secretaria_puede_modificar_turnos_otros_usuarios)
    ])?;
    stmt.execute(params![
        "mostrar_acciones_en_lista_pagos",
        opt_bool(&settings.mostrar_acciones_en_lista_pagos)
    ])?;
    Ok(())
}

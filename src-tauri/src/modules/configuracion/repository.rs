use rusqlite::{params, Connection, Transaction, OptionalExtension};
use crate::core::error::AppError;
use super::dto::*;

fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    let sql = format!("PRAGMA table_info({table})");
    if let Ok(mut stmt) = conn.prepare(&sql) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) {
            for r in rows.flatten() {
                if r.eq_ignore_ascii_case(column) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn load_patients(conn: &Connection) -> Result<Vec<Patient>, AppError> {
    let has_os_ant = has_column(conn, "patients", "obra_social_anterior");
    let query = if has_os_ant {
        "SELECT id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, COALESCE(version, 1), deleted_at, obra_social_anterior FROM patients WHERE deleted_at IS NULL"
    } else {
        "SELECT id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, COALESCE(version, 1), deleted_at, NULL FROM patients WHERE deleted_at IS NULL"
    };
    let mut stmt = conn.prepare(query)?;
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
            obra_social_anterior: row.get(14)?,
            notas: row.get(10)?,
            activo: Some(row.get::<_, i32>(11)? != 0),
            version: row.get(12)?,
            deleted_at: row.get(13)?,
        })
    })?;
    
    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

/// Lee un paciente directo de la tabla por id, INCLUYENDO los dados de baja.
/// No usa load_patients (esa filtra deleted_at IS NULL). Se usa para el cuerpo 409.
pub fn get_patient_by_id(conn: &Connection, id: &str) -> Result<Option<Patient>, AppError> {
    let has_os_ant = has_column(conn, "patients", "obra_social_anterior");
    let query = if has_os_ant {
        "SELECT id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, COALESCE(version, 1), deleted_at, obra_social_anterior FROM patients WHERE id = ?1"
    } else {
        "SELECT id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, COALESCE(version, 1), deleted_at, NULL FROM patients WHERE id = ?1"
    };
    let patient = conn.query_row(
        query,
        params![id],
        |row| {
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
                obra_social_anterior: row.get(14)?,
                notas: row.get(10)?,
                activo: Some(row.get::<_, i32>(11)? != 0),
                version: row.get(12)?,
                deleted_at: row.get(13)?,
            })
        },
    ).optional()?;
    Ok(patient)
}

pub fn save_patients(tx: &Transaction<'_>, patients: &[Patient]) -> Result<(), AppError> {
    let has_os_ant = has_column(tx, "patients", "obra_social_anterior");
    for p in patients {
        let activo_val = if p.activo.unwrap_or(true) { 1 } else { 0 };
        
        let existing = if has_os_ant {
            tx.query_row(
                "SELECT nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version, obra_social_anterior FROM patients WHERE id = ?1", 
                params![p.id], 
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, i32>(10)?,
                        row.get::<_, i32>(11)?,
                        row.get::<_, Option<String>>(12)?,
                    ))
                }
            ).optional()?
        } else {
            tx.query_row(
                "SELECT nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version FROM patients WHERE id = ?1", 
                params![p.id], 
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, i32>(10)?,
                        row.get::<_, i32>(11)?,
                        None,
                    ))
                }
            ).optional()?
        };

        let changed = match &existing {
            Some((n, a, d, t, e, dom, l, fn_date, os, nt, act, _v, os_ant)) => {
                n != &p.nombre || a != &p.apellido || d != &p.dni || t != &p.telefono || e != &p.email ||
                dom != &p.domicilio || l != &p.localidad || fn_date != &p.fecha_nacimiento ||
                os != &p.obra_social || nt != &p.notas || 
                (*act != 0 && !p.activo.unwrap_or(true)) || 
                (*act == 0 && p.activo.unwrap_or(true)) ||
                (has_os_ant && os_ant.as_deref().unwrap_or("") != p.obra_social_anterior.as_deref().unwrap_or(""))
            }
            None => true,
        };

        if changed {
            if existing.is_some() {
                if has_os_ant {
                    tx.execute(
                        "UPDATE patients SET nombre=?1, apellido=?2, dni=?3, telefono=?4, email=?5, domicilio=?6, localidad=?7, fecha_nacimiento=?8, obra_social=?9, notas=?10, activo=?11, obra_social_anterior=?12, version=version+1 WHERE id=?13",
                        params![p.nombre, p.apellido, p.dni, p.telefono, p.email, p.domicilio, p.localidad, p.fecha_nacimiento, p.obra_social, p.notas, activo_val, p.obra_social_anterior, p.id],
                    )?;
                } else {
                    tx.execute(
                        "UPDATE patients SET nombre=?1, apellido=?2, dni=?3, telefono=?4, email=?5, domicilio=?6, localidad=?7, fecha_nacimiento=?8, obra_social=?9, notas=?10, activo=?11, version=version+1 WHERE id=?12",
                        params![p.nombre, p.apellido, p.dni, p.telefono, p.email, p.domicilio, p.localidad, p.fecha_nacimiento, p.obra_social, p.notas, activo_val, p.id],
                    )?;
                }
            } else {
                if has_os_ant {
                    tx.execute(
                        "INSERT INTO patients (id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version, obra_social_anterior)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                        params![p.id, p.nombre, p.apellido, p.dni, p.telefono, p.email, p.domicilio, p.localidad, p.fecha_nacimiento, p.obra_social, p.notas, activo_val, 1, p.obra_social_anterior],
                    )?;
                } else {
                    tx.execute(
                        "INSERT INTO patients (id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                        params![p.id, p.nombre, p.apellido, p.dni, p.telefono, p.email, p.domicilio, p.localidad, p.fecha_nacimiento, p.obra_social, p.notas, activo_val, 1],
                    )?;
                }
            }
        }
    }
    Ok(())
}

pub fn load_doctors(conn: &Connection) -> Result<Vec<Doctor>, AppError> {
    let mut stmt = conn.prepare("SELECT id, nombre, apellido, dni, matricula, especialidad, obra_social, obras_sociales_json, telefono, localidad, email, alias, porcentaje, duracion_turno_minutos, tipo_agenda, activo, COALESCE(valor, 0), COALESCE(particular, 0), COALESCE(cuidar, 0) FROM doctors")?;
    let rows = stmt.query_map([], |row| {
        let obras_sociales_json: String = row.get(7)?;
        let obras_sociales: Option<Vec<DoctorObraSocial>> = serde_json::from_str(&obras_sociales_json).ok();
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
            valor: row.get(16)?,
            particular: row.get(17)?,
            cuidar: row.get(18)?,
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
        "INSERT OR REPLACE INTO doctors (id, nombre, apellido, dni, matricula, especialidad, obra_social, obras_sociales_json, telefono, localidad, email, alias, porcentaje, duracion_turno_minutos, tipo_agenda, activo, valor, particular, cuidar)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)"
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
            activo_val,
            d.valor,
            d.particular,
            d.cuidar
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
    let mut stmt = conn.prepare("SELECT id, patient_id, doctor_id, fecha_hora, duracion_minutos, notas, estado, whatsapp_recordatorio_enviado_en, obra_social_override, motivo_consulta_2, creado_por, modificado_por, modificado_en FROM appointments")?;
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
            motivo_consulta_2: row.get(9)?,
            creado_por: row.get(10)?,
            modificado_por: row.get(11)?,
            modificado_en: row.get(12)?,
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
        "INSERT OR REPLACE INTO appointments (id, patient_id, doctor_id, fecha_hora, duracion_minutos, notas, estado, whatsapp_recordatorio_enviado_en, obra_social_override, motivo_consulta_2, creado_por, modificado_por, modificado_en)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
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
            a.obra_social_override,
            a.motivo_consulta_2,
            a.creado_por,
            a.modificado_por,
            a.modificado_en
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
            "write_enabled" | "writeEnabled" => {
                settings.write_enabled = Some(value == "1" || value == "true");
            }
            _ => {}
        }
    }
    Ok(settings)
}

/// Como load_settings pero recibe un Transaction (para usar dentro de transacciones).
pub fn load_settings_from_tx(tx: &Transaction<'_>) -> Result<AppSettings, AppError> {
    let mut stmt = tx.prepare("SELECT key, value FROM app_settings")?;
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
            "write_enabled" | "writeEnabled" => {
                settings.write_enabled = Some(value == "1" || value == "true");
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

/// Carga un módulo almacenado como JSON (afiliados, planes, cuotas, distribución).
pub fn load_app_module(conn: &Connection, key: &str) -> Result<Vec<serde_json::Value>, AppError> {
    let json: Option<String> = conn
        .query_row("SELECT json FROM app_modules WHERE key = ?1", params![key], |row| row.get(0))
        .ok();
    match json {
        Some(raw) if !raw.trim().is_empty() => {
            Ok(serde_json::from_str(&raw).unwrap_or_default())
        }
        _ => Ok(Vec::new()),
    }
}

/// Guarda un módulo como JSON en app_modules.
// ---- Afiliados, planes y cuotas: tablas con el objeto JSON completo ----
// Cada fila guarda el objeto entero en `data` (los campos reales de la UI) y
// `version` como columna propia para la concurrencia por registro. Las filas
// viejas (data NULL) se leen con la forma minima anterior.

fn row_version(v: &serde_json::Value) -> i64 {
    v.get("version")
        .and_then(|x| x.as_i64())
        .filter(|n| *n >= 1)
        .unwrap_or(1)
}

fn load_json_table(conn: &Connection, table: &str, legacy_col: &str) -> Result<Vec<serde_json::Value>, AppError> {
    let sql = format!("SELECT id, {legacy_col}, version, data FROM {table} ORDER BY rowid");
    let mut stmt = conn.prepare(&sql)?;
    let raw = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let legacy = match row.get_ref(1)? {
            rusqlite::types::ValueRef::Text(t) => {
                serde_json::Value::String(String::from_utf8_lossy(t).into_owned())
            }
            rusqlite::types::ValueRef::Real(f) => serde_json::json!(f),
            rusqlite::types::ValueRef::Integer(i) => serde_json::json!(i),
            _ => serde_json::Value::Null,
        };
        let version: Option<i64> = row.get(2)?;
        let data: Option<String> = row.get(3)?;
        Ok((id, legacy, version, data))
    })?;
    let mut res = Vec::new();
    for r in raw {
        let (id, legacy, version, data) = r?;
        match data {
            Some(text) => {
                let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
                    AppError::Database(format!("{table}: dato JSON invalido en '{id}': {e}"))
                })?;
                res.push(v);
            }
            None => {
                let mut m = serde_json::Map::new();
                m.insert("id".to_string(), serde_json::Value::String(id));
                m.insert(legacy_col.to_string(), legacy);
                m.insert("version".to_string(), serde_json::json!(version.unwrap_or(1)));
                res.push(serde_json::Value::Object(m));
            }
        }
    }
    Ok(res)
}



fn save_json_table(
    tx: &Transaction<'_>,
    table: &str,
    legacy_col: &str,
    values: &[serde_json::Value],
) -> Result<(), AppError> {
    tx.execute(&format!("DELETE FROM {table}"), [])?;
 








   let sql = format!("INSERT INTO {table} (id, {legacy_col}, version, data) VALUES (?1, ?2, ?3, ?4)");
    let mut stmt = tx.prepare(&sql)?;
    for v in values {
        let id = v
            .get("id")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
 






           .ok_or_else(|| AppError::Database(format!("{table}: falta el id en un registro")))?;
        let legacy = match v.get(legacy_col) {
            Some(serde_json::Value::String(s)) => rusqlite::types::Value::Text(s.clone()),
            Some(n) if n.is_number() => rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0)),
            _ => rusqlite::types::Value::Null,
 




       };
        let data = serde_json::to_string(v).map_err(|e| {
            AppError::Database(format!("{table}: no se pudo serializar '{id}': {e}"))
        })?;
        stmt.execute(params![id, legacy, row_version(v), data])?;
 




   }
    Ok(())
}

pub fn load_afiliados_table(conn: &Connection) -> Result<Vec<serde_json::Value>, AppError> {
 




   load_json_table(conn, "afiliados", "nombre")
}

pub fn load_planes_table(conn: &Connection) -> Result<Vec<serde_json::Value>, AppError> {
 



   load_json_table(conn, "planes_afiliados", "nombre")
}

pub fn load_cuotas_table(conn: &Connection) -> Result<Vec<serde_json::Value>, AppError> {
 



   load_json_table(conn, "cuotas_afiliados", "monto")
}

pub fn save_afiliados_table(tx: &Transaction<'_>, values: &[serde_json::Value]) -> Result<(), AppError> {
    save_json_table(tx, "afiliados", "nombre", values)?;
    if has_column(tx, "contratante_movimientos", "afiliado_id") {
        tx.execute("DELETE FROM contratante_movimientos", [])?;
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO contratante_movimientos (id, afiliado_id, tipo, fecha, detalle, motivo, usuario, creado_en, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        )?;
        for afil in values {
            let afil_id = afil.get("id").and_then(|x| x.as_str()).unwrap_or("");
            if let Some(movs) = afil.get("movimientos").and_then(|x| x.as_array()) {
                for m in movs {
                    let id = m.get("id").and_then(|x| x.as_str()).unwrap_or("");
                    if id.is_empty() || afil_id.is_empty() {
                        continue;
                    }
                    let tipo = m.get("tipo").and_then(|x| x.as_str()).unwrap_or("alta");
                    let fecha = m.get("fecha").and_then(|x| x.as_str()).unwrap_or("");
                    let detalle = m.get("detalle").and_then(|x| x.as_str()).unwrap_or("");
                    let motivo = m.get("motivo").and_then(|x| x.as_str());
                    let usuario = m.get("usuario").and_then(|x| x.as_str()).unwrap_or("");
                    let creado_en = m.get("creadoEn").and_then(|x| x.as_str()).unwrap_or(fecha);
                    let raw = serde_json::to_string(m).unwrap_or_default();
                    stmt.execute(params![id, afil_id, tipo, fecha, detalle, motivo, usuario, creado_en, raw])?;
                }
            }
        }
    }
    Ok(())
}




pub fn save_planes_table(tx: &Transaction<'_>, values: &[serde_json::Value]) -> Result<(), AppError> {
    save_json_table(tx, "planes_afiliados", "nombre", values)
}




pub fn save_cuotas_table(tx: 

&Transaction<'_>, values: &[serde_json::Value]) -> Result<(), AppError> {
    save_json_table(tx, "cuotas_afiliados", "monto", values)
}

/// Guarda un afiliado por registro con control de versión.
/// Devuelve WriteResult::Conflict con la versión actual si hay conflicto,
/// WriteResult::Saved si se guardó correctamente.
pub fn save_afiliado(tx: &Transaction<'_>, afiliado: &super::dto::Afiliado) -> Result<WriteResult, AppError> {
    let existing: Option<i32> = tx.query_row(
        "SELECT version FROM afiliados WHERE id = ?1",
        params![&afiliado.id],
        |row| row.get(0),
    ).optional()?;

    match existing {
        Some(v) => {
            if v != afiliado.version {
                return Ok(WriteResult::Conflict { current_version: v });
            }
            tx.execute(
                "UPDATE afiliados SET nombre = ?1, version = version + 1 WHERE id = ?2",
                params![&afiliado.nombre, &afiliado.id],
            )?;
            Ok(WriteResult::Saved)
        }
        None => {
            tx.execute(
                "INSERT INTO afiliados (id, nombre, version) VALUES (?1, ?2, ?3)",
                params![&afiliado.id, &afiliado.nombre, 1],
            )?;
            Ok(WriteResult::Saved)
        }
    }
}

/// Guarda un plan de afiliado por registro con control de versión.
pub fn save_plan_afiliado(tx: &Transaction<'_>, plan: &super::dto::PlanAfiliado) -> Result<WriteResult, AppError> {
    let existing: Option<i32> = tx.query_row(
        "SELECT version FROM planes_afiliados WHERE id = ?1",
        params![&plan.id],
        |row| row.get(0),
    ).optional()?;

    match existing {
        Some(v) => {
            if v != plan.version {
                return Ok(WriteResult::Conflict { current_version: v });
            }
            tx.execute(
                "UPDATE planes_afiliados SET nombre = ?1, version = version + 1 WHERE id = ?2",
                params![&plan.nombre, &plan.id],
            )?;
            Ok(WriteResult::Saved)
        }
        None => {
            tx.execute(
                "INSERT INTO planes_afiliados (id, nombre, version) VALUES (?1, ?2, ?3)",
                params![&plan.id, &plan.nombre, 1],
            )?;
            Ok(WriteResult::Saved)
        }
    }
}

/// Guarda una cuota de afiliado por registro con control de versión.
pub fn save_cuota_afiliado(tx: &Transaction<'_>, cuota: &super::dto::CuotaAfiliado) -> Result<WriteResult, AppError> {
    let existing: Option<i32> = tx.query_row(
        "SELECT version FROM cuotas_afiliados WHERE id = ?1",
        params![&cuota.id],
        |row| row.get(0),
    ).optional()?;

    match existing {
        Some(v) => {
            if v != cuota.version {
                return Ok(WriteResult::Conflict { current_version: v });
            }
            tx.execute(
                "UPDATE cuotas_afiliados SET monto = ?1, version = version + 1 WHERE id = ?2",
                params![&cuota.monto, &cuota.id],
            )?;
            Ok(WriteResult::Saved)
        }
        None => {
            tx.execute(
                "INSERT INTO cuotas_afiliados (id, monto, version) VALUES (?1, ?2, ?3)",
                params![&cuota.id, &cuota.monto, 1],
            )?;
            Ok(WriteResult::Saved)
        }
    }
}

pub fn save_app_module(tx: &Transaction<'_>, key: &str, values: &[serde_json::Value]) -> Result<(), AppError> {
    let json = serde_json::to_string(values)
        .map_err(|e| AppError::Validation(format!("JSON inválido para {key}: {e}")))?;
    tx.execute(
        "INSERT OR REPLACE INTO app_modules (key, json) VALUES (?1, ?2)",
        params![key, json],
    )?;
    Ok(())
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
    stmt.execute(params![
        "write_enabled",
        opt_bool(&settings.write_enabled)
    ])?;
    Ok(())
}

/// Escribe una entrada de auditoría en la tabla audit_log.
/// No incluye datos sensibles de pacientes ni contraseñas.
pub fn write_audit_log(
    tx: &Transaction<'_>,
    usuario: &str,
    rol: &str,
    accion: &str,
    entidad: &str,
    entidad_id: Option<&str>,
    detalle: Option<&str>,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO audit_log (usuario, rol, accion, entidad, entidad_id, fecha_hora, detalle)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), ?6)",
        params![
            usuario,
            rol,
            accion,
            entidad,
            entidad_id,
            detalle
        ],
    )?;
    Ok(())
}

/// Crea un paciente nuevo. Si el id ya existe (aunque esté dado de baja) devuelve
/// Conflict y nunca lo resucita. La auditoría se escribe en la MISMA transacción.
pub fn create_patient(
    tx: &Transaction<'_>,
    patient: &super::dto::Patient,
    usuario: &str,
    rol: &str,
) -> Result<super::dto::PatientWriteResult, AppError> {
    let existing: Option<i32> = tx.query_row(
        "SELECT COALESCE(version, 1) FROM patients WHERE id = ?1",
        params![&patient.id],
        |row| row.get(0),
    ).optional()?;

    match existing {
        Some(v) => {
            Ok(super::dto::PatientWriteResult::Conflict { current_version: v })
        }
        None => {
            tx.execute(
                "INSERT INTO patients (id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, NULL)",
                params![
                    &patient.id,
                    &patient.nombre,
                    &patient.apellido,
                    &patient.dni,
                    &patient.telefono,
                    &patient.email,
                    &patient.domicilio,
                    &patient.localidad,
                    &patient.fecha_nacimiento,
                    &patient.obra_social,
                    &patient.notas,
                    if patient.activo.unwrap_or(true) { 1 } else { 0 },
                ],
            )?;
            write_audit_log(
                tx,
                usuario,
                rol,
                "CREATE_PACIENTE",
                "pacientes",
                Some(&patient.id),
                Some("Alta de paciente por API"),
            )?;
            Ok(super::dto::PatientWriteResult::Saved)
        }
    }
}

/// Actualiza un paciente existente. Reemplazo total de las 12 columnas editables;
/// si `activo` viene None se conserva el valor actual de la base.
/// Un paciente dado de baja no se edita (Conflict).
pub fn update_patient(
    tx: &Transaction<'_>,
    patient: &super::dto::Patient,
    usuario: &str,
    rol: &str,
) -> Result<super::dto::PatientWriteResult, AppError> {
    let row: Option<(i32, Option<String>, i32)> = tx.query_row(
        "SELECT COALESCE(version, 1), deleted_at, activo FROM patients WHERE id = ?1",
        params![&patient.id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;

    match row {
        None => {
            Ok(super::dto::PatientWriteResult::NotFound)
        }
        Some((v, deleted_at, activo_actual)) => {
            if deleted_at.is_some() {
                return Ok(super::dto::PatientWriteResult::Conflict { current_version: v });
            }
            if v != patient.version {
                return Ok(super::dto::PatientWriteResult::Conflict { current_version: v });
            }
            // activo: si viene None, conservar el valor actual de la base
            let activo_val = match patient.activo {
                Some(b) => if b { 1 } else { 0 },
                None => activo_actual,
            };
            let affected = tx.execute(
                "UPDATE patients SET nombre=?1, apellido=?2, dni=?3, telefono=?4, email=?5, domicilio=?6, localidad=?7, fecha_nacimiento=?8, obra_social=?9, notas=?10, activo=?11, version=COALESCE(version,1)+1 WHERE id=?12 AND COALESCE(version,1)=?13",
                params![
                    &patient.nombre,
                    &patient.apellido,
                    &patient.dni,
                    &patient.telefono,
                    &patient.email,
                    &patient.domicilio,
                    &patient.localidad,
                    &patient.fecha_nacimiento,
                    &patient.obra_social,
                    &patient.notas,
                    activo_val,
                    &patient.id,
                    &patient.version,
                ],
            )?;
            if affected == 0 {
                // Re-read current version in case of conflict
                let current: i32 = tx.query_row(
                    "SELECT COALESCE(version, 1) FROM patients WHERE id = ?1",
                    params![&patient.id],
                    |row| row.get(0),
                ).unwrap_or(1);
                Ok(super::dto::PatientWriteResult::Conflict { current_version: current })
            } else {
                write_audit_log(
                    tx,
                    usuario,
                    rol,
                    "UPDATE_PACIENTE",
                    "pacientes",
                    Some(&patient.id),
                    Some("Edición de paciente por API"),
                )?;
                Ok(super::dto::PatientWriteResult::Saved)
            }
        }
    }
}

/// Baja lógica de un paciente (setea deleted_at). Nunca borra físicamente.
/// La auditoría BAJA_PACIENTE se escribe en la MISMA transacción.
pub fn baja_patient(
    tx: &Transaction<'_>,
    id: &str,
    version: i32,
    usuario: &str,
    rol: &str,
) -> Result<super::dto::PatientWriteResult, AppError> {
    let row: Option<(i32, Option<String>)> = tx.query_row(
        "SELECT COALESCE(version, 1), deleted_at FROM patients WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;

    match row {
        None => {
            Ok(super::dto::PatientWriteResult::NotFound)
        }
        Some((v, deleted_at)) => {
            if deleted_at.is_some() {
                return Ok(super::dto::PatientWriteResult::Conflict { current_version: v });
            }
            if v != version {
                return Ok(super::dto::PatientWriteResult::Conflict { current_version: v });
            }
            let affected = tx.execute(
                "UPDATE patients SET deleted_at = datetime('now'), version = COALESCE(version,1)+1 WHERE id = ?1 AND COALESCE(version,1) = ?2",
                params![id, version],
            )?;
            if affected == 0 {
                let current: i32 = tx.query_row(
                    "SELECT COALESCE(version, 1) FROM patients WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                ).unwrap_or(1);
                Ok(super::dto::PatientWriteResult::Conflict { current_version: current })
            } else {
                write_audit_log(
                    tx,
                    usuario,
                    rol,
                    "BAJA_PACIENTE",
                    "pacientes",
                    Some(id),
                    Some("Baja lógica de paciente por API"),
                )?;
                Ok(super::dto::PatientWriteResult::Saved)
            }
        }
    }
}

/// Carga los registros de auditoría (solo admin debería llamar a esto).
pub fn load_audit_log(conn: &Connection) -> Result<Vec<AuditLogEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, usuario, rol, accion, entidad, entidad_id, fecha_hora, detalle
         FROM audit_log
         ORDER BY fecha_hora DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AuditLogEntry {
            id: row.get(0)?,
            usuario: row.get(1)?,
            rol: row.get(2)?,
            accion: row.get(3)?,
            entidad: row.get(4)?,
            entidad_id: row.get(5)?,
            fecha_hora: row.get(6)?,
            detalle: row.get(7)?,
        })
    })?;
    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn load_obras_sociales(conn: &Connection) -> Result<Vec<ObraSocialCatalog>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT nombre, plus, arancel, cuidar, imp_banco, imp_factura, gastos_adm, suspendida, version FROM obras_sociales ORDER BY nombre ASC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ObraSocialCatalog {
            nombre: row.get(0)?,
            plus: row.get(1)?,
            arancel: row.get(2)?,
            cuidar: row.get(3)?,
            imp_banco: row.get(4)?,
            imp_factura: row.get(5)?,
            gastos_adm: row.get(6)?,
            suspendida: row.get::<_, i32>(7)? != 0,
            version: row.get(8)?,
        })
    })?;
    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn save_obras_sociales(tx: &Transaction<'_>, items: &[ObraSocialCatalog]) -> Result<(), AppError> {
    let mut stmt = tx.prepare(
        "INSERT INTO obras_sociales (nombre, plus, arancel, cuidar, imp_banco, imp_factura, gastos_adm, suspendida, version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(nombre) DO UPDATE SET
            plus = excluded.plus,
            arancel = excluded.arancel,
            cuidar = excluded.cuidar,
            imp_banco = excluded.imp_banco,
            imp_factura = excluded.imp_factura,
            gastos_adm = excluded.gastos_adm,
            suspendida = excluded.suspendida,
            version = obras_sociales.version + 1"
    )?;
    for item in items {
        stmt.execute(params![
            item.nombre,
            item.plus,
            item.arancel,
            item.cuidar,
            item.imp_banco,
            item.imp_factura,
            item.gastos_adm,
            if item.suspendida { 1 } else { 0 },
            if item.version > 0 { item.version } else { 1 }
        ])?;
    }
    Ok(())
}

pub fn save_obra_social_single(
    conn: &Connection,
    item: &ObraSocialCatalog,
) -> Result<ObraSocialWriteResult, AppError> {
    let existing: Option<ObraSocialCatalog> = conn
        .query_row(
            "SELECT nombre, plus, arancel, cuidar, imp_banco, imp_factura, gastos_adm, suspendida, version FROM obras_sociales WHERE nombre = ?1 COLLATE NOCASE",
            params![&item.nombre],
            |row| {
                Ok(ObraSocialCatalog {
                    nombre: row.get(0)?,
                    plus: row.get(1)?,
                    arancel: row.get(2)?,
                    cuidar: row.get(3)?,
                    imp_banco: row.get(4)?,
                    imp_factura: row.get(5)?,
                    gastos_adm: row.get(6)?,
                    suspendida: row.get::<_, i32>(7)? != 0,
                    version: row.get(8)?,
                })
            },
        )
        .optional()?;

    if let Some(curr) = existing {
        if item.version != 0 && item.version != curr.version {
            return Ok(ObraSocialWriteResult::Conflict { current: Some(curr) });
        }
        let next_version = curr.version + 1;
        conn.execute(
            "UPDATE obras_sociales SET plus=?1, arancel=?2, cuidar=?3, imp_banco=?4, imp_factura=?5, gastos_adm=?6, suspendida=?7, version=?8 WHERE nombre=?9 COLLATE NOCASE",
            params![
                item.plus,
                item.arancel,
                item.cuidar,
                item.imp_banco,
                item.imp_factura,
                item.gastos_adm,
                if item.suspendida { 1 } else { 0 },
                next_version,
                &item.nombre
            ],
        )?;
        let mut saved = item.clone();
        saved.version = next_version;
        Ok(ObraSocialWriteResult::Saved(saved))
    } else {
        conn.execute(
            "INSERT INTO obras_sociales (nombre, plus, arancel, cuidar, imp_banco, imp_factura, gastos_adm, suspendida, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
            params![
                item.nombre,
                item.plus,
                item.arancel,
                item.cuidar,
                item.imp_banco,
                item.imp_factura,
                item.gastos_adm,
                if item.suspendida { 1 } else { 0 },
            ],
        )?;
        let mut saved = item.clone();
        saved.version = 1;
        Ok(ObraSocialWriteResult::Saved(saved))
    }
}

pub fn delete_obra_social(conn: &Connection, nombre: &str) -> Result<Result<(), String>, AppError> {
    let doctors = load_doctors(conn)?;
    let in_use_count = doctors.iter().filter(|d| {
        let direct_match = d.obra_social.as_deref().map(|s| s.eq_ignore_ascii_case(nombre)).unwrap_or(false);
        let list_match = d.obras_sociales.as_ref().map(|list| {
            list.iter().any(|os| os.nombre.eq_ignore_ascii_case(nombre))
        }).unwrap_or(false);
        direct_match || list_match
    }).count();

    if in_use_count > 0 {
        return Ok(Err(format!(
            "La obra social '{nombre}' está en uso por {in_use_count} médicos, suspendela en su lugar."
        )));
    }

    conn.execute(
        "DELETE FROM obras_sociales WHERE nombre = ?1 COLLATE NOCASE",
        params![nombre],
    )?;
    Ok(Ok(()))
}

/// Registra atómicamente un paciente nuevo y su correspondiente contratante/afiliado.
pub fn registrar_contratante_con_paciente_nuevo(
    tx: &Transaction<'_>,
    req: &super::dto::RegistrarContratanteConPacienteNuevoReq,
    usuario: &str,
    rol: &str,
) -> Result<(super::dto::Patient, serde_json::Value), AppError> {
    // 1. Validar unicidad de DNI (en pacientes activos y no eliminados)
    let existing_dni: Option<(String, String)> = tx
        .query_row(
            "SELECT apellido, nombre FROM patients WHERE dni = ?1 AND deleted_at IS NULL",
            params![&req.dni],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((ap, nom)) = existing_dni {
        return Err(AppError::Validation(format!(
            "Ese DNI ya está cargado: {ap}, {nom}"
        )));
    }

    // 2. Validar que no exista un paciente con el mismo ID
    let existing_id: Option<i32> = tx
        .query_row(
            "SELECT 1 FROM patients WHERE id = ?1",
            params![&req.patient_id],
            |row| row.get(0),
        )
        .optional()?;
    if existing_id.is_some() {
        return Err(AppError::Validation(format!(
            "Ya existe un paciente con el id {}",
            req.patient_id
        )));
    }

    // 3. Insertar paciente
    tx.execute(
        "INSERT INTO patients (id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version, deleted_at)
         VALUES (?1, ?2, ?3, ?4, '', '', '', '', ?5, ?6, '', 1, 1, NULL)",
        params![
            &req.patient_id,
            &req.nombre,
            &req.apellido,
            &req.dni,
            &req.fecha_nacimiento,
            &req.plan_nombre,
        ],
    )?;

    // 4. Insertar contratante en afiliados
    let afil_id = req
        .afiliado_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("afil_{}", req.patient_id));

    let afil_nombre = format!("{}, {}", req.apellido, req.nombre);
    let afil_data = serde_json::json!({
        "id": afil_id,
        "patientId": req.patient_id,
        "planId": req.plan_id,
        "fechaInicio": req.fecha_inicio,
        "activo": true,
        "obraSocialAnterior": "",
        "adherentes": []
    });
    let data_str = serde_json::to_string(&afil_data)?;

    tx.execute(
        "INSERT INTO afiliados (id, nombre, version, data) VALUES (?1, ?2, 1, ?3)",
        params![&afil_id, &afil_nombre, &data_str],
    )?;

    // 5. Auditoría
    write_audit_log(
        tx,
        usuario,
        rol,
        "CREATE_PACIENTE",
        "pacientes",
        Some(&req.patient_id),
        Some("Alta de paciente junto con contratante"),
    )?;

    write_audit_log(
        tx,
        usuario,
        rol,
        "CREATE_AFILIADO",
        "afiliados",
        Some(&afil_id),
        Some("Alta de contratante con paciente nuevo"),
    )?;

    let patient = super::dto::Patient {
        id: req.patient_id.clone(),
        nombre: req.nombre.clone(),
        apellido: req.apellido.clone(),
        dni: req.dni.clone(),
        telefono: String::new(),
        email: String::new(),
        domicilio: String::new(),
        localidad: String::new(),
        fecha_nacimiento: req.fecha_nacimiento.clone(),
        obra_social: req.plan_nombre.clone(),
        obra_social_anterior: Some(String::new()),
        notas: String::new(),
        activo: Some(true),
        version: 1,
        deleted_at: None,
    };

    Ok((patient, afil_data))
}

#[cfg(test)]
mod afiliados_roundtrip_tests {
    use super::*;
    use serde_json::json;

    fn conn_con_tablas() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(concat!(include_str!("../../../migrations/0006_afiliados_tablas.sql"), "\n", include_str!("../../../migrations/0008_afiliados_datos_completos.sql")))
            .unwrap();
        conn
    }

    #[test]
    fn afiliados_roundtrip_no_pierde_campos() {
        let conn = conn_con_tablas();
        let afi = vec![json!({
            "id": "a1",
            "patientId": "p1",
            "planId": "pl1",
            "fechaInicio": "2026-01-15",
            "activo": true
        })];
        let tx = conn.unchecked_transaction().unwrap();
        save_afiliados_table(&tx, &afi).unwrap();
        tx.commit().unwrap();
        let loaded = load_afiliados_table(&conn).unwrap();
        assert_eq!(loaded, afi, "guardar y recargar no debe perder campos del afiliado");
    }

    #[test]
    fn afiliados_roundtrip_conserva_la_version() {
        let conn = conn_con_tablas();
        let afi = vec![json!({
            "id": "a1",
            "patientId": "p1",
            "planId": "pl1",
            "fechaInicio": "2026-01-15",
            "activo": true,
            "version": 3
        })];
        let tx = conn.unchecked_transaction().unwrap();
        save_afiliados_table(&tx, &afi).unwrap();
        tx.commit().unwrap();
        let loaded = load_afiliados_table(&conn).unwrap();
        assert_eq!(loaded[0]["version"], 3, "la version no debe reiniciarse a 1");
    }
}

#[cfg(test)]
mod tablas_json_extra_tests {
    use super::*;
    use serde_json::json;

    fn conn_con_tablas() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(concat!(
            include_str!("../../../migrations/0006_afiliados_tablas.sql"),
            "\n",
            include_str!("../../../migrations/0008_afiliados_datos_completos.sql")
        ))
        .unwrap();
        conn
    }

    #[test]
    fn filas_viejas_sin_data_se_leen_en_forma_minima() {
        let conn = conn_con_tablas();
        conn.execute("INSERT INTO afiliados (id, nombre, version) VALUES ('x', 'Viejo', 4)", [])
            .unwrap();
        let loaded = load_afiliados_table(&conn).unwrap();
        assert_eq!(loaded, vec![json!({"id": "x", "nombre": "Viejo", "version": 4})]);
    }

    #[test]
    fn registro_sin_id_da_error_y_no_borra_lo_anterior() {
        let conn = conn_con_tablas();
        conn.execute(
            "INSERT INTO afiliados (id, nombre, version, data) VALUES ('keep', 'K', 1, '{\"id\":\"keep\"}')",
            [],
        )
        .unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        let res = save_afiliados_table(&tx, &[json!({"patientId": "p1"})]);
        assert!(res.is_err());
        drop(tx); // rollback
        assert_eq!(load_afiliados_table(&conn).unwrap().len(), 1);
    }

    #[test]
    fn planes_y_cuotas_conservan_todos_sus_campos() {
        let conn = conn_con_tablas();
        let planes = vec![json!({"id": "pl1", "nombre": "Plan A", "usos": 2, "version": 5})];
        let cuotas = vec![json!({"id": "c1", "monto": 1500.5, "afiliadoId": "a1", "mes": "2026-01"})];
        let tx = conn.unchecked_transaction().unwrap();
        save_planes_table(&tx, &planes).unwrap();
        save_cuotas_table(&tx, &cuotas).unwrap();
        tx.commit().unwrap();
        assert_eq!(load_planes_table(&conn).unwrap(), planes);
        assert_eq!(load_cuotas_table(&conn).unwrap(), cuotas);
    }
}

#[cfg(test)]
mod contratante_con_paciente_nuevo_tests {
    use super::*;

    fn conn_con_todas_tablas() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(concat!(
            include_str!("../../../migrations/0001_init.sql"),
            "\n",
            include_str!("../../../migrations/0006_afiliados_tablas.sql"),
            "\n",
            include_str!("../../../migrations/0007_pacientes_version_auditoria.sql"),
            "\n",
            include_str!("../../../migrations/0008_afiliados_datos_completos.sql")
        ))
        .unwrap();
        conn
    }

    #[test]
    fn test_alta_exitosa_paciente_y_contratante() {
        let conn = conn_con_todas_tablas();
        let tx = conn.unchecked_transaction().unwrap();
        let req = RegistrarContratanteConPacienteNuevoReq {
            patient_id: "pac_nuevo_1".to_string(),
            dni: "44111222".to_string(),
            fecha_nacimiento: "1995-05-20".to_string(),
            apellido: "GARCIA".to_string(),
            nombre: "LUCAS".to_string(),
            plan_id: "plan_individual".to_string(),
            plan_nombre: "Individual".to_string(),
            fecha_inicio: "2026-11-09".to_string(),
            afiliado_id: None,
        };

        let (pac, afil) = registrar_contratante_con_paciente_nuevo(&tx, &req, "Admin", "admin").unwrap();
        tx.commit().unwrap();

        assert_eq!(pac.dni, "44111222");
        assert_eq!(pac.apellido, "GARCIA");
        assert_eq!(pac.nombre, "LUCAS");
        assert_eq!(pac.fecha_nacimiento, "1995-05-20");
        assert_eq!(pac.obra_social, "Individual");

        assert_eq!(afil["patientId"], "pac_nuevo_1");
        assert_eq!(afil["planId"], "plan_individual");

        let db_pac = load_patients(&conn).unwrap();
        let found_pac = db_pac.iter().find(|p| p.id == "pac_nuevo_1").unwrap();
        assert_eq!(found_pac.dni, "44111222");
        assert_eq!(found_pac.obra_social, "Individual");

        let db_afil = load_afiliados_table(&conn).unwrap();
        assert_eq!(db_afil.len(), 1);
        assert_eq!(db_afil[0]["patientId"], "pac_nuevo_1");
    }

    #[test]
    fn test_dni_repetido_devuelve_error_y_no_crea() {
        let conn = conn_con_todas_tablas();
        conn.execute(
            "INSERT INTO patients (id, nombre, apellido, dni, activo, version) VALUES ('p_orig', 'JUAN', 'PEREZ', '33444555', 1, 1)",
            [],
        )
        .unwrap();

        let tx = conn.unchecked_transaction().unwrap();
        let req = RegistrarContratanteConPacienteNuevoReq {
            patient_id: "p_otro".to_string(),
            dni: "33444555".to_string(),
            fecha_nacimiento: "1990-01-01".to_string(),
            apellido: "OTRO".to_string(),
            nombre: "MARCOS".to_string(),
            plan_id: "plan_ind".to_string(),
            plan_nombre: "Individual".to_string(),
            fecha_inicio: "2026-11-09".to_string(),
            afiliado_id: None,
        };

        let res = registrar_contratante_con_paciente_nuevo(&tx, &req, "Admin", "admin");
        assert!(res.is_err());
        let err_msg = format!("{}", res.err().unwrap());
        assert!(err_msg.contains("Ese DNI ya está cargado: PEREZ, JUAN"));
    }

    #[test]
    fn test_rollback_atomico_no_deja_paciente_huerfano() {
        let conn = conn_con_todas_tablas();
        conn.execute(
            "INSERT INTO afiliados (id, nombre, version, data) VALUES ('afil_forzado', 'Ya existe', 1, '{}')",
            [],
        )
        .unwrap();

        let tx = conn.unchecked_transaction().unwrap();
        let req = RegistrarContratanteConPacienteNuevoReq {
            patient_id: "p_huerfano".to_string(),
            dni: "99887766".to_string(),
            fecha_nacimiento: "2000-01-01".to_string(),
            apellido: "LOPEZ".to_string(),
            nombre: "ANA".to_string(),
            plan_id: "plan_ind".to_string(),
            plan_nombre: "Individual".to_string(),
            fecha_inicio: "2026-11-09".to_string(),
            afiliado_id: Some("afil_forzado".to_string()),
        };

        let res = registrar_contratante_con_paciente_nuevo(&tx, &req, "Admin", "admin");
        assert!(res.is_err(), "Debe fallar al intentar duplicar afiliado");
        drop(tx);

        let db_pac = load_patients(&conn).unwrap();
        assert!(!db_pac.iter().any(|p| p.id == "p_huerfano"), "El paciente no debe haber quedado persistido");
    }
}

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Patient {
    pub id: String,
    pub nombre: String,
    pub apellido: String,
    pub dni: String,
    pub telefono: String,
    pub email: String,
    pub domicilio: String,
    pub localidad: String,
    pub fecha_nacimiento: String,
    pub obra_social: String,
    pub notas: String,
    pub activo: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Doctor {
    pub id: String,
    pub nombre: String,
    pub apellido: String,
    pub dni: String,
    pub matricula: String,
    pub especialidad: String,
    pub obra_social: Option<String>,
    pub obras_sociales: Option<Vec<String>>,
    pub telefono: String,
    pub localidad: String,
    pub email: String,
    pub alias: Option<String>,
    pub porcentaje: Option<f64>,
    pub duracion_turno_minutos: Option<u32>,
    pub tipo_agenda: Option<String>,
    pub activo: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DoctorHorario {
    pub id: String,
    pub doctor_id: String,
    pub dia_semana: u32,
    pub hora_inicio: String,
    pub hora_fin: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DoctorDiaLibre {
    pub id: String,
    pub doctor_id: String,
    pub dia_semana: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DoctorAtencionMensual {
    pub id: String,
    pub doctor_id: String,
    pub fecha: String,
    pub hora_inicio: String,
    pub hora_fin: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Appointment {
    pub id: String,
    pub patient_id: String,
    pub doctor_id: String,
    pub fecha_hora: String,
    pub duracion_minutos: u32,
    pub notas: String,
    pub estado: String,
    pub whatsapp_recordatorio_enviado_en: Option<String>,
    pub obra_social_override: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    pub patient_id: String,
    pub doctor_id: String,
    pub cita_id: Option<String>,
    pub monto: f64,
    pub fecha: String,
    pub metodo: String,
    pub notas: String,
    pub porcentaje_aplicado: Option<f64>,
    pub obra_social_override: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AtencionSinTurnoFila {
    pub patient_id: String,
    pub monto: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AtencionSinTurnoListado {
    pub id: String,
    pub doctor_id: String,
    pub fecha: String,
    pub filas: Vec<AtencionSinTurnoFila>,
    pub guardado_en: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PagoCancelado {
    pub id: String,
    pub motivo: String,
    pub cancelado_en: String,
    pub payment: Payment,
    pub appointment: Option<Appointment>,
    pub notas_otros: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DoctorDebtPayment {
    pub id: String,
    pub doctor_id: String,
    pub deuda_key: String,
    pub fecha: String,
    pub monto: f64,
    pub metodo: String,
    /// A quién se le paga la deuda (por defecto "Gerencia").
    #[serde(default = "destinatario_por_defecto")]
    pub destinatario: String,
    /// Nº de comprobante del pago. Opcional.
    #[serde(default)]
    pub nro_comprobante: String,
    pub nota: String,
}

fn destinatario_por_defecto() -> String {
    "Gerencia".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub email: String,
    pub email_gerente: String,
    pub telefono_gerente: String,
    pub clave: String,
    pub telefono: String,
    pub cuit: String,
    pub carpeta_backup_google_drive: Option<String>,
    pub carpeta_exportar_google_drive: Option<String>,
    pub carpeta_pdfs_google_drive: Option<String>,
    pub ruta_google_drive_custom: Option<String>,
    pub google_drive_deshabilitado: Option<bool>,
    pub google_drive_setup_completado: Option<bool>,
    pub secretaria_puede_modificar_mes_actual: Option<bool>,
    pub secretaria_puede_modificar_turnos_otros_usuarios: Option<bool>,
    pub mostrar_acciones_en_lista_pagos: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub patients: Vec<Patient>,
    pub doctors: Vec<Doctor>,
    pub horarios: Vec<DoctorHorario>,
    pub dias_libres: Vec<DoctorDiaLibre>,
    pub atenciones_mensuales: Vec<DoctorAtencionMensual>,
    pub appointments: Vec<Appointment>,
    pub payments: Vec<Payment>,
    pub atenciones_sin_turno: Vec<AtencionSinTurnoListado>,
    pub pagos_cancelados: Vec<PagoCancelado>,
    #[serde(default)]
    pub pagos_deudas_medicos: Vec<DoctorDebtPayment>,
    #[serde(default)]
    pub especialidades_custom: Vec<String>,
    #[serde(default)]
    pub obras_sociales_custom: Vec<String>,
    #[serde(default)]
    pub localidades_custom: Vec<String>,
    #[serde(default)]
    pub motivos_consulta_custom: Vec<String>,
    pub settings: AppSettings,
}

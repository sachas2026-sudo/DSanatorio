use serde::{Deserialize, Serialize};

fn default_version() -> i32 { 1 }

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub obra_social_anterior: Option<String>,
    pub notas: String,
    pub activo: Option<bool>,
    #[serde(default = "default_version")]
    pub version: i32,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DoctorObraSocial {
    pub nombre: String,
    #[serde(default)]
    pub porcentaje: f64,
    #[serde(default)]
    pub monto: i64,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum DoctorObraSocialDe {
    Legacy(String),
    Object {
        nombre: String,
        #[serde(default)]
        porcentaje: f64,
        #[serde(default)]
        monto: i64,
    },
}

impl<'de> Deserialize<'de> for DoctorObraSocial {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let item = DoctorObraSocialDe::deserialize(deserializer)?;
        match item {
            DoctorObraSocialDe::Legacy(nombre) => Ok(DoctorObraSocial {
                nombre,
                porcentaje: 0.0,
                monto: 0,
            }),
            DoctorObraSocialDe::Object {
                nombre,
                porcentaje,
                monto,
            } => Ok(DoctorObraSocial {
                nombre,
                porcentaje,
                monto,
            }),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Doctor {
    pub id: String,
    pub nombre: String,
    pub apellido: String,
    pub dni: String,
    pub matricula: String,
    pub especialidad: String,
    pub obra_social: Option<String>,
    #[serde(default)]
    pub obras_sociales: Option<Vec<DoctorObraSocial>>,
    pub telefono: String,
    pub localidad: String,
    pub email: String,
    pub alias: Option<String>,
    pub porcentaje: Option<f64>,
    pub duracion_turno_minutos: Option<u32>,
    pub tipo_agenda: Option<String>,
    pub activo: Option<bool>,
    #[serde(default)]
    pub valor: i64,
    #[serde(default)]
    pub particular: i64,
    #[serde(default)]
    pub cuidar: i64,
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
    #[serde(default)]
    pub motivo_consulta_2: Option<String>,
    #[serde(default)]
    pub creado_por: Option<String>,
    #[serde(default)]
    pub modificado_por: Option<String>,
    #[serde(default)]
    pub modificado_en: Option<String>,
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
    #[serde(default)]
    pub write_enabled: Option<bool>,
}

#[derive(Debug)]
pub enum ObraSocialWriteResult {
    Saved(ObraSocialCatalog),
    Conflict { current: Option<ObraSocialCatalog> },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObraSocialCatalog {
    pub nombre: String,
    #[serde(default)]
    pub plus: i64,
    #[serde(default)]
    pub arancel: i64,
    #[serde(default)]
    pub cuidar: i64,
    #[serde(default)]
    pub imp_banco: i64,
    #[serde(default)]
    pub imp_factura: i64,
    #[serde(default)]
    pub gastos_adm: i64,
    #[serde(default)]
    pub suspendida: bool,
    #[serde(default = "default_version_one")]
    pub version: i64,
}

fn default_version_one() -> i64 {
    1
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
    pub obras_sociales: Vec<ObraSocialCatalog>,
    #[serde(default)]
    pub obras_sociales_custom: Vec<String>,
    #[serde(default)]
    pub localidades_custom: Vec<String>,
    #[serde(default)]
    pub motivos_consulta_custom: Vec<String>,
    pub settings: AppSettings,
    #[serde(default)]
    pub afiliados: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub planes_afiliados: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub cuotas_afiliados: Option<Vec<serde_json::Value>>,
    #[serde(default, rename = "distribucionOSPercentajes")]
    pub distribucion_os_percentajes: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub ordenes_medicas: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub prestaciones_afiliados: Option<Vec<serde_json::Value>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: i64,
    pub usuario: String,
    pub rol: String,
    pub accion: String,
    pub entidad: String,
    pub entidad_id: Option<String>,
    pub fecha_hora: String,
    pub detalle: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Afiliado {
    pub id: String,
    pub nombre: String,
    #[serde(default = "default_version")]
    pub version: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanAfiliado {
    pub id: String,
    pub nombre: String,
    #[serde(default = "default_version")]
    pub version: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegistrarContratanteConPacienteNuevoReq {
    pub patient_id: String,
    pub dni: String,
    pub apellido: String,
    pub nombre: String,
    pub fecha_nacimiento: String,
    pub plan_id: String,
    pub plan_nombre: String,
    pub fecha_inicio: String,
    #[serde(default)]
    pub afiliado_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CuotaAfiliado {
    pub id: String,
    pub monto: f64,
    #[serde(default = "default_version")]
    pub version: i32,
}

pub enum WriteResult {
    Saved,
    Conflict { current_version: i32 },
}

#[derive(Debug)]
pub enum PatientWriteResult {
    Saved,
    Conflict { current_version: i32 },
    NotFound,
}

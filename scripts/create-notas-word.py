"""Genera Centro-Medico-Notas-Importantes.docx en la raíz del proyecto."""
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Centro-Medico-Notas-Importantes.docx"

SECTIONS = [
    (
        "1. DÓNDE SE GUARDAN LOS DATOS",
        [
            "Programa: C:\\Sanatorio\\app\\",
            "Base de datos: C:\\Sanatorio\\datos\\sanatorio-datos.json",
            "Respaldos: C:\\Sanatorio\\respaldo\\",
            "Al actualizar el programa NO se borran datos ni respaldos (solo se reemplaza la carpeta app).",
        ],
    ),
    (
        "2. RESPALDOS",
        [
            "Al cerrar la app se rotan 3 copias automáticas (respaldo-1 es el más reciente).",
            "Respaldo diario: carpeta C:\\Sanatorio\\respaldo\\diario\\ (se conservan 30 días).",
            "Opcional: si hay Dropbox, también en Dropbox\\Sanatorio\\respaldo\\",
            "Desde Configuración (solo administración): ver rutas, restaurar respaldo 1-3, exportar/importar JSON, enviar copia por correo al Email Gerente.",
            "Si la base falla al abrir, la app ofrece restaurar desde respaldo 1, 2 o 3.",
        ],
    ),
    (
        "3. EDITAR PACIENTES Y MÉDICOS (DNI, TELÉFONO, NOMBRE)",
        [
            "Los turnos y pagos guardan solo el enlace interno (ID del paciente/médico), no una copia del DNI.",
            "Si editás un paciente (cargás DNI después, cambiás teléfono, etc.) el turno y el pago NO se reescriben: siguen vinculados al mismo paciente.",
            "Lo que ves en pantalla, PDF o Excel hoy muestra los datos ACTUALES del paciente (si antes no tenía DNI y después lo cargás, al consultar verás el DNI nuevo).",
            "El porcentaje del médico en cada cobro SÍ queda congelado al momento del pago.",
            "Solo al ELIMINAR un paciente o médico se borran turnos/pagos vinculados. Suspender NO borra historial.",
        ],
    ),
    (
        "4. INFORMES PARA GERENCIA (PAGOS)",
        [
            "Exportar a Gerencia (Excel): administración y secretaría. Incluye pagos activos y cancelados del período, con DNI Med, DNI Pac, montos, %, etc. La pastilla recuerda la fecha del último exportado.",
            "PDF Gerencia, PDF Obra Social y correo con PDF Gerencia: solo administración.",
            "PDF Resumen por Médico (con nombres de pacientes): administración y secretaría.",
            "PDF Cobranzas incluye hoja RENDICIÓN (totales por médico) al exportar todos los médicos.",
            "Los informes toman los datos actuales del paciente/médico al generarlos.",
        ],
    ),
    (
        "5. ROLES DE USUARIO",
        [
            "Administración (Admi): todo — Configuración, Mantenimiento, Pagos cancelados, exportaciones Gerencia completas.",
            "Secretaría: pacientes, médicos, agenda, cobros, Excel Gerencia y PDF con detalle de pacientes; sin Configuración ni PDF Gerencia exclusivo de admin.",
        ],
    ),
    (
        "6. PACIENTES Y MÉDICOS SUSPENDIDOS",
        [
            "No aparecen para turnos nuevos ni en listas operativas.",
            "Turnos, pagos e historial anteriores se conservan.",
        ],
    ),
    (
        "7. MANTENIMIENTO — ARCHIVAR HISTORIAL",
        [
            "Mueve turnos/pagos/cancelados viejos a C:\\Sanatorio\\datos\\historico\\ (no borra pacientes ni médicos).",
            "Sirve para aligerar la base si hay muchos años de datos.",
        ],
    ),
    (
        "8. BUENAS PRÁCTICAS",
        [
            "Cerrar la app al final del día (genera respaldos).",
            "Antes de instalar una actualización: cerrar la app y ejecutar el instalador como administrador; no desinstalar antes.",
            "Revisar en Configuración que Email y Email Gerente estén cargados si usan envío de informes.",
            "No editar a mano sanatorio-datos.json con la app abierta.",
        ],
    ),
]


def main() -> None:
    doc = Document()
    title = doc.add_heading("CENTRO MÉDICO — NOTAS IMPORTANTES", level=0)
    for run in title.runs:
        run.font.size = Pt(18)

    sub = doc.add_paragraph("Versión 2.3.0 — uso diario")
    sub.runs[0].font.size = Pt(10)
    sub.runs[0].font.color.rgb = RGBColor(100, 116, 139)

    doc.add_paragraph()

    for heading, bullets in SECTIONS:
        h = doc.add_heading(heading, level=2)
        for run in h.runs:
            run.font.size = Pt(12)
        for text in bullets:
            doc.add_paragraph(text, style="List Bullet")

    doc.save(OUT)
    print(f"OK: {OUT}")
    print(f"Tamaño: {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

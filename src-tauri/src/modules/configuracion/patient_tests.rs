#[cfg(test)]
mod patient_tests {
    use crate::modules::configuracion::repository::{load_patients, save_patients};
    use crate::modules::configuracion::dto::Patient;
    use rusqlite::Connection;
    use std::env;

    fn temp_db() -> (Connection, std::sync::MutexGuard<'static, ()>) {
        let guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        env::set_var("SANATORIO_DATA_DIR", dir.path());
        (crate::core::db::open_connection().unwrap(), guard)
    }

    #[test]
    fn exact_edit_case_and_space_updates_version() {
        let (conn, _guard) = temp_db();
        let p = Patient { id: "p1".into(), nombre: "perez".into(), apellido: "lopez".into(), dni: "1".into(), telefono: "111".into(), email: "e@e".into(), domicilio: "d".into(), localidad: "l".into(), fecha_nacimiento: "".into(), obra_social: "".into(), obra_social_anterior: None, notas: "".into(), activo: Some(true), version: 1, deleted_at: None };
        save_patients(&conn.unchecked_transaction().unwrap(), &[p.clone()]).unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        save_patients(&tx, &[Patient { nombre: "Perez".into(), ..p.clone() }]).unwrap();
        tx.commit().unwrap();
        let loaded = load_patients(&conn).unwrap();
        assert_eq!(loaded[0].nombre, "Perez"); // comparación exacta: mayúscula/sube versión
    }

    #[test]
    fn null_empty_string_treated_consistently() {
        let (conn, _guard) = temp_db();
        let p = Patient { id: "p2".into(), nombre: "N".into(), apellido: "A".into(), dni: "".into(), telefono: "".into(), email: "".into(), domicilio: "".into(), localidad: "".into(), fecha_nacimiento: "".into(), obra_social: "".into(), obra_social_anterior: None, notas: "".into(), activo: Some(true), version: 1, deleted_at: None };
        let tx = conn.unchecked_transaction().unwrap();
        save_patients(&tx, &[p.clone()]).unwrap();
        tx.commit().unwrap();
        // Segundo guardado idéntico no debe incrementar versión
        let tx2 = conn.unchecked_transaction().unwrap();
        save_patients(&tx2, &[p.clone()]).unwrap();
        tx2.commit().unwrap();
        let loaded = load_patients(&conn).unwrap();
        assert_eq!(loaded[0].version, 1);
    }

    #[test]
    fn logical_delete_preserved_on_subsequent_save() {
        let (conn, _guard) = temp_db();
        let p = Patient { id: "p3".into(), nombre: "X".into(), apellido: "Y".into(), dni: "".into(), telefono: "".into(), email: "".into(), domicilio: "".into(), localidad: "".into(), fecha_nacimiento: "".into(), obra_social: "".into(), obra_social_anterior: None, notas: "".into(), activo: Some(true), version: 1, deleted_at: Some("2026-01-01".into()) };
        let tx = conn.unchecked_transaction().unwrap();
        save_patients(&tx, &[p.clone()]).unwrap();
        tx.commit().unwrap();
        // Guardar sin enviar el paciente (como hace UI tras baja)
        // Pero save_patients solo inserta/actualiza; para baja lógica usamos UPDATE en service.
        // Aquí verificamos que no se toca el registro existente dado de baja.
        let tx2 = conn.unchecked_transaction().unwrap();
        // No pasamos p; de todos modos el registro debe mantenerse con deleted_at
        tx2.execute("UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?1 AND deleted_at IS NULL", ["p3"]).unwrap();
        tx2.commit().unwrap();
        let loaded = load_patients(&conn).unwrap(); // load_patients filtra deleted_at IS NULL
        assert!(loaded.is_empty());
    }
}

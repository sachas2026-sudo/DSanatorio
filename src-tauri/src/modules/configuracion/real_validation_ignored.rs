#[cfg(test)]
mod real_validation_ignored {
    use std::env;

    #[test]
    #[ignore = "solo contra la copia real SANATORIO_DATA_DIR"]
    fn validate_copy_1074_patients_no_version_change() {
        env::var("SANATORIO_DATA_DIR").expect("SANATORIO_DATA_DIR debe apuntar a la copia");
        let conn = crate::core::db::open_connection().unwrap();

        // Antes de cargar y guardar
        let total_before: i64 = conn.query_row("SELECT count(*) FROM patients", [], |r| r.get(0)).unwrap();
        let inactivos_before: i64 = conn.query_row("SELECT count(*) FROM patients WHERE activo = 0", [], |r| r.get(0)).unwrap();
        let baja_before: i64 = conn.query_row("SELECT count(*) FROM patients WHERE deleted_at IS NOT NULL", [], |r| r.get(0)).unwrap();
        let vers_before: i64 = conn.query_row("SELECT count(*) FROM patients WHERE version != 1", [], |r| r.get(0)).unwrap();
        println!("ANTES -> total={} inactivos={} baja_logica={} vers!=1={}", total_before, inactivos_before, baja_before, vers_before);

        // Cargar y guardar sin cambios (camino real de la app)
        let data = crate::modules::configuracion::service::load_app_data().unwrap();
        crate::modules::configuracion::service::save_app_data_direct(&data).unwrap();

        // Después de cargar y guardar
        let total_after: i64 = conn.query_row("SELECT count(*) FROM patients", [], |r| r.get(0)).unwrap();
        let inactivos_after: i64 = conn.query_row("SELECT count(*) FROM patients WHERE activo = 0", [], |r| r.get(0)).unwrap();
        let baja_after: i64 = conn.query_row("SELECT count(*) FROM patients WHERE deleted_at IS NOT NULL", [], |r| r.get(0)).unwrap();
        let vers_after: i64 = conn.query_row("SELECT count(*) FROM patients WHERE version != 1", [], |r| r.get(0)).unwrap();
        println!("DESPUES -> total={} inactivos={} baja_logica={} vers!=1={}", total_after, inactivos_after, baja_after, vers_after);

        assert_eq!(total_before, total_after, "Total de pacientes cambió");
        assert_eq!(inactivos_before, inactivos_after, "Inactivos cambiaron");
        assert_eq!(baja_before, baja_after, "Baja lógica afectada");
        assert_eq!(vers_before, vers_after, "Versión alterada sin cambio real");
    }

    #[test]
    #[ignore = "solo contra la copia real SANATORIO_DATA_DIR"]
    fn validate_double_open_on_migrated_db() {
        env::var("SANATORIO_DATA_DIR").expect("SANATORIO_DATA_DIR debe apuntar a la copia");
        // Primera apertura: aplica migraciones pendientes (incluida 0007 si corresponde)
        let conn1 = crate::core::db::open_connection().unwrap();
        let version1: i32 = conn1
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))
            .unwrap_or(0);
        println!("Primera apertura -> schema_migrations max version = {}", version1);

        drop(conn1);

        // Segunda apertura: no debe volver a aplicar migraciones ni fallar
        let conn2 = crate::core::db::open_connection().unwrap();
        let version2: i32 = conn2
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))
            .unwrap_or(0);
        println!("Segunda apertura -> schema_migrations max version = {}", version2);

        assert_eq!(version1, version2, "La versión de esquema cambió entre aperturas");
        assert!(version1 >= 7, "La migración 0007 debería haberse aplicado");
    }
}

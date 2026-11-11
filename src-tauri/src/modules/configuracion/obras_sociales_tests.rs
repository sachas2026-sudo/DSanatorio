#[cfg(test)]
mod obras_sociales_tests {
    use crate::modules::configuracion::dto::{Doctor, ObraSocialCatalog, ObraSocialWriteResult};
    use crate::modules::configuracion::repository::{
        delete_obra_social, load_obras_sociales, save_doctors, save_obra_social_single,
    };
    use rusqlite::Connection;
    use std::env;

    fn temp_db() -> (Connection, std::sync::MutexGuard<'static, ()>) {
        let guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        env::set_var("SANATORIO_DATA_DIR", dir.path());
        (crate::core::db::open_connection().unwrap(), guard)
    }

    #[test]
    fn test_roundtrip_save_and_load_obra_social() {
        let (conn, _guard) = temp_db();
        let item = ObraSocialCatalog {
            nombre: "Test OS".into(),
            plus: 25000,
            arancel: 40000,
            cuidar: 250,      // 2,50%
            imp_banco: 150,   // 1,50%
            imp_factura: 300, // 3,00%
            gastos_adm: 500,  // 5,00%
            suspendida: false,
            version: 1,
        };

        let res = save_obra_social_single(&conn, &item).unwrap();
        match res {
            ObraSocialWriteResult::Saved(saved) => {
                assert_eq!(saved.nombre, "Test OS");
                assert_eq!(saved.plus, 25000);
                assert_eq!(saved.arancel, 40000);
                assert_eq!(saved.cuidar, 250);
                assert_eq!(saved.imp_banco, 150);
                assert_eq!(saved.imp_factura, 300);
                assert_eq!(saved.gastos_adm, 500);
                assert_eq!(saved.version, 1);
            }
            ObraSocialWriteResult::Conflict { .. } => panic!("No debería dar conflicto"),
        }

        let list = load_obras_sociales(&conn).unwrap();
        let loaded = list.iter().find(|o| o.nombre == "Test OS").expect("Debe existir en la lista");
        assert_eq!(loaded.plus, 25000);
        assert_eq!(loaded.arancel, 40000);
        assert_eq!(loaded.cuidar, 250);
        assert_eq!(loaded.imp_banco, 150);
        assert_eq!(loaded.imp_factura, 300);
        assert_eq!(loaded.gastos_adm, 500);
        assert_eq!(loaded.suspendida, false);
    }

    #[test]
    fn test_compatibilidad_migracion_y_sembrado() {
        let (conn, _guard) = temp_db();
        // La migración 0010 siembra los 12 habituales por defecto
        let list = load_obras_sociales(&conn).unwrap();
        assert!(list.len() >= 12, "Debe haber al menos las 12 habituales");

        let osde = list.iter().find(|o| o.nombre.eq_ignore_ascii_case("OSDE")).expect("OSDE debe estar sembrada");
        assert_eq!(osde.plus, 0);
        assert_eq!(osde.arancel, 0);
        assert_eq!(osde.cuidar, 0);
        assert_eq!(osde.suspendida, false);
        assert_eq!(osde.version, 1);

        let ips = list.iter().find(|o| o.nombre.eq_ignore_ascii_case("IPS")).expect("IPS debe estar sembrada");
        assert_eq!(ips.plus, 0);
        assert_eq!(ips.version, 1);
    }

    #[test]
    fn test_conflict_optimista_version_409() {
        let (conn, _guard) = temp_db();
        let item = ObraSocialCatalog {
            nombre: "Concurrente OS".into(),
            plus: 1000,
            arancel: 2000,
            cuidar: 100,
            imp_banco: 0,
            imp_factura: 0,
            gastos_adm: 0,
            suspendida: false,
            version: 1,
        };
        // Primer guardado -> versión 1
        save_obra_social_single(&conn, &item).unwrap();

        // Usuario A actualiza con version 1 -> sube a versión 2
        let item_v1 = ObraSocialCatalog {
            plus: 1500,
            ..item.clone()
        };
        let res_a = save_obra_social_single(&conn, &item_v1).unwrap();
        assert!(matches!(res_a, ObraSocialWriteResult::Saved(_)));

        // Usuario B intenta actualizar mandando la versión vieja 1 -> devuelve Conflict
        let item_b = ObraSocialCatalog {
            plus: 9999,
            ..item.clone()
        };
        let res_b = save_obra_social_single(&conn, &item_b).unwrap();
        match res_b {
            ObraSocialWriteResult::Conflict { current } => {
                let curr = current.expect("Debe devolver el registro actual");
                assert_eq!(curr.version, 2);
                assert_eq!(curr.plus, 1500);
            }
            ObraSocialWriteResult::Saved(_) => panic!("Debió detectar conflicto de versión"),
        }
    }

    #[test]
    fn test_quitar_bloqueado_si_medico_la_usa() {
        let (conn, _guard) = temp_db();
        // Insertar médico que usa "OSDE"
        let doc = Doctor {
            id: "doc-test-1".into(),
            nombre: "Juan".into(),
            apellido: "Pérez".into(),
            dni: "12345678".into(),
            matricula: "M1".into(),
            especialidad: "Clínica".into(),
            obra_social: Some("OSDE".into()),
            obras_sociales: None,
            telefono: "".into(),
            localidad: "".into(),
            email: "".into(),
            alias: None,
            porcentaje: Some(0.0),
            duracion_turno_minutos: Some(30),
            tipo_agenda: Some("semanal".into()),
            activo: Some(true),
            valor: 0,
            particular: 0,
            cuidar: 0,
        };
        let tx = conn.unchecked_transaction().unwrap();
        save_doctors(&tx, &[doc]).unwrap();
        tx.commit().unwrap();

        // Intentar borrar OSDE debe ser rechazado
        let res = delete_obra_social(&conn, "OSDE").unwrap();
        match res {
            Ok(_) => panic!("Debió bloquear el borrado porque el médico la usa"),
            Err(msg) => {
                assert!(msg.contains("está en uso por 1 médicos, suspendela"));
            }
        }

        // Borrar una obra social que nadie usa debe ser permitido
        let res_libre = delete_obra_social(&conn, "Accord Salud").unwrap();
        assert!(res_libre.is_ok(), "Debe permitir borrar obra social que no está en uso");
    }

    #[test]
    fn test_suspender_conserva_datos() {
        let (conn, _guard) = temp_db();
        let item = ObraSocialCatalog {
            nombre: "Suspender OS".into(),
            plus: 8000,
            arancel: 12000,
            cuidar: 300,
            imp_banco: 50,
            imp_factura: 100,
            gastos_adm: 150,
            suspendida: false,
            version: 1,
        };
        save_obra_social_single(&conn, &item).unwrap();

        // Suspender
        let suspended_item = ObraSocialCatalog {
            suspendida: true,
            ..item
        };
        save_obra_social_single(&conn, &suspended_item).unwrap();

        let list = load_obras_sociales(&conn).unwrap();
        let loaded = list.iter().find(|o| o.nombre == "Suspender OS").unwrap();
        assert_eq!(loaded.suspendida, true);
        assert_eq!(loaded.plus, 8000);
        assert_eq!(loaded.arancel, 12000);
    }
}


use std::fs;
use std::path::Path;

#[derive(Debug)]
pub enum LockError {
    Busy,
    Io(String),
}

pub struct LockGuard {
    #[cfg(windows)]
    _file: std::fs::File,
    #[cfg(not(windows))]
    _marker: (),
}

pub fn try_lock(dir: &Path) -> Result<LockGuard, LockError> {
    let _ = fs::create_dir_all(dir);
    let lock_path = dir.join("sanatorio.lock");

    #[cfg(windows)] {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;
        const ERROR_SHARING_VIOLATION: i32 = 32;
        match OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .share_mode(0)
            .open(&lock_path) {
            Ok(file) => Ok(LockGuard { _file: file }),
            Err(err) if err.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => Err(LockError::Busy),
            Err(err) => Err(LockError::Io(err.to_string())),
        }
    }
    #[cfg(not(windows))] {
        Ok(LockGuard { _marker: () })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[cfg(windows)]
    #[test]
    fn dos_try_lock_seguidos_segundo_busy() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        let guard1 = try_lock(dir).unwrap();
        let result = try_lock(dir);
        assert!(matches!(result, Err(LockError::Busy)), "segundo try_lock debe dar Busy");

        drop(guard1);
    }

    #[cfg(windows)]
    #[test]
    fn soltar_primero_tercero_adquiere_ok() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        let guard1 = try_lock(dir).unwrap();
        drop(guard1);

        // El archivo sigue existiendo (huérfano)
        assert!(dir.join("sanatorio.lock").exists(), "archivo huérfano debe seguir existiendo");

        // Pero un nuevo try_lock debe funcionar
        let guard2 = try_lock(dir).unwrap();
        drop(guard2);
    }

}
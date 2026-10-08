//! Dateisystem-Helfer, die mehrere Module brauchen.

use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::time::Duration;

/// Endung der Zwischendateien von `write_atomic`. Steht in der `.gitignore`
/// der Projekte, damit ein Überbleibsel nach einem Absturz nie im Verlauf landet.
pub(crate) const TMP_SUFFIX: &str = ".distelfink-tmp";

/// Schreibt `data` nach `path`, ohne dass dort je eine halbe Datei stehen kann:
/// erst in eine Nachbardatei, die auf die Platte gezwungen wird, dann per
/// Umbenennen gegen das Original getauscht. Ein Absturz oder Stromausfall
/// mittendrin lässt so entweder den alten oder den neuen Stand zurück — nie
/// eine leere Szene, die der Sync dann auch noch verteilt.
pub(crate) fn write_atomic(path: &Path, data: impl AsRef<[u8]>) -> io::Result<()> {
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Pfad ohne Dateinamen"))?;
    let suffix = &uuid::Uuid::new_v4().simple().to_string()[..8];
    let tmp = path.with_file_name(format!(".{}.{suffix}{TMP_SUFFIX}", name.to_string_lossy()));

    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data.as_ref())?;
        file.sync_all()?;
        drop(file);
        replace(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Tauscht `tmp` gegen `path`. Unter Windows hält ein Sync-Client oder
/// Virenscanner die Zieldatei manchmal kurz offen — dann ein paar Mal nachfassen.
fn replace(tmp: &Path, path: &Path) -> io::Result<()> {
    let mut attempt = 0;
    loop {
        match fs::rename(tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied && attempt < 5 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(20 * attempt));
            }
            Err(e) => return Err(e),
        }
    }
}

/// Räumt Zwischendateien weg, die ein Absturz in `dir` hinterlassen hat.
pub(crate) fn remove_stale_tmp_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().ends_with(TMP_SUFFIX) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ersetzt_inhalt_und_hinterlaesst_keine_zwischendatei() {
        let dir = std::env::temp_dir().join(format!("distelfink-fsutil-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("szene.md");
        fs::write(&path, "alt").unwrap();

        write_atomic(&path, "neu").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "neu");
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn raeumt_reste_weg() {
        let dir = std::env::temp_dir().join(format!("distelfink-fsutil-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!(".szene.md.abc{TMP_SUFFIX}")), "rest").unwrap();
        fs::write(dir.join("szene.md"), "text").unwrap();

        remove_stale_tmp_files(&dir);

        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("szene.md")]);
        let _ = fs::remove_dir_all(&dir);
    }
}

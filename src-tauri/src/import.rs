use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::db::{self, Document};

const PDF_HEADER: &[u8] = b"%PDF-";

pub fn import_pdf(source: &Path, documents_dir: &Path, conn: &Connection) -> Result<Document, String> {
    let original_filename = original_filename(source)?;
    if !has_pdf_extension(&original_filename) {
        return Err("Можно импортировать только PDF".to_string());
    }

    let mut input = File::open(source).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "Файл не найден".to_string()
        } else {
            format!("Не удалось открыть файл: {err}")
        }
    })?;

    let mut header = [0u8; 5];
    let read = input
        .read(&mut header)
        .map_err(|err| format!("Не удалось прочитать файл: {err}"))?;
    if read < PDF_HEADER.len() || &header[..PDF_HEADER.len()] != PDF_HEADER {
        return Err("Файл не является PDF".to_string());
    }

    std::fs::create_dir_all(documents_dir)
        .map_err(|err| format!("Не удалось создать каталог библиотеки: {err}"))?;
    let internal_filename = unique_internal_name(documents_dir)?;
    let destination = documents_dir.join(&internal_filename);
    let mut output = match File::create(&destination) {
        Ok(file) => file,
        Err(err) => return Err(format!("Не удалось скопировать PDF: {err}")),
    };

    let mut hasher = Sha256::new();
    if let Err(message) = write_chunk(&mut output, &mut hasher, &header) {
        return Err(abort_copy(&destination, message));
    }
    let mut size = header.len() as i64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = match input.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(err) => {
                return Err(abort_copy(
                    &destination,
                    format!("Не удалось прочитать PDF: {err}"),
                ));
            }
        };
        if let Err(message) = write_chunk(&mut output, &mut hasher, &buffer[..read]) {
            return Err(abort_copy(&destination, message));
        }
        size += read as i64;
    }
    if let Err(err) = output.sync_all() {
        return Err(abort_copy(
            &destination,
            format!("Не удалось сохранить копию PDF: {err}"),
        ));
    }
    drop(output);

    let imported = db::insert_imported_document(
        conn,
        &title_from_filename(&original_filename),
        &original_filename,
        &internal_filename,
        &destination,
        size,
        &to_hex(&hasher.finalize()),
    );
    if let Err(err) = &imported {
        let message = if let Err(remove_err) = std::fs::remove_file(&destination) {
            format!("{err}. Не удалось удалить незавершённую копию: {remove_err}")
        } else {
            err.clone()
        };
        return Err(message);
    }
    imported
}

fn original_filename(source: &Path) -> Result<String, String> {
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty() && name != "." && name != "..")
        .ok_or_else(|| "Не удалось определить имя файла".to_string())?;
    Ok(name)
}

fn has_pdf_extension(filename: &str) -> bool {
    Path::new(filename)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

fn title_from_filename(filename: &str) -> String {
    let stem = Path::new(filename)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| filename.to_string());
    let stem = stem.trim();
    if stem.is_empty() {
        filename.to_string()
    } else {
        stem.to_string()
    }
}

fn unique_internal_name(documents_dir: &Path) -> Result<String, String> {
    for _ in 0..10 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Не удалось выбрать имя для копии PDF".to_string())?
            .as_nanos();
        let name = format!("{nanos}.pdf");
        if !documents_dir.join(&name).exists() {
            return Ok(name);
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    Err("Не удалось выбрать имя для копии PDF".to_string())
}

fn write_chunk(output: &mut File, hasher: &mut Sha256, bytes: &[u8]) -> Result<(), String> {
    hasher.update(bytes);
    output
        .write_all(bytes)
        .map_err(|err| format!("Не удалось скопировать PDF: {err}"))
}

fn abort_copy(destination: &Path, message: String) -> String {
    if let Err(err) = std::fs::remove_file(destination) {
        if err.kind() != std::io::ErrorKind::NotFound {
            return format!("{message}. Не удалось удалить незавершённую копию: {err}");
        }
    }
    message
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

    struct TempLibrary {
        root: PathBuf,
    }

    impl TempLibrary {
        fn new() -> Self {
            let n = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!("llr-import-{nanos}-{n}"));
            std::fs::create_dir_all(root.join("documents")).unwrap();
            Self { root }
        }

        fn documents(&self) -> PathBuf {
            self.root.join("documents")
        }

        fn database(&self) -> Connection {
            open(&self.root.join("library.db")).unwrap()
        }
    }

    impl Drop for TempLibrary {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn copies_pdf_without_changing_the_source() {
        let library = TempLibrary::new();
        let source_dir = library.root.join("source");
        let bytes = b"%PDF-1.4\nstage3\n%%EOF";
        let source = write_source(&source_dir, "My Book.PDF", bytes);
        let before = std::fs::read(&source).unwrap();
        let conn = library.database();

        let document = import_pdf(&source, &library.documents(), &conn).unwrap();

        assert_eq!(std::fs::read(&source).unwrap(), before);
        assert_eq!(document.title, "My Book");
        assert_eq!(document.original_filename.as_deref(), Some("My Book.PDF"));
        assert!(document
            .internal_filename
            .as_deref()
            .unwrap()
            .ends_with(".pdf"));
        assert_ne!(
            document.internal_filename.as_deref(),
            Some("My Book.PDF")
        );
        let stored_path = PathBuf::from(document.path.clone().unwrap());
        assert_eq!(stored_path.parent().unwrap(), library.documents());
        assert_eq!(std::fs::read(&stored_path).unwrap(), bytes);
        assert_eq!(document.file_size, Some(bytes.len() as i64));
        assert_eq!(document.hash.as_deref(), Some(sha256_hex(bytes).as_str()));
        assert!(!document.created_at.is_empty());

        let listed = db::list_documents(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, document.id);
    }

    #[test]
    fn rejects_unsupported_file_without_copying() {
        let library = TempLibrary::new();
        let source = write_source(&library.root.join("source"), "notes.txt", b"hello");
        let conn = library.database();

        let err = import_pdf(&source, &library.documents(), &conn).unwrap_err();
        assert!(err.contains("только PDF"));
        assert!(std::fs::read_dir(library.documents()).unwrap().next().is_none());
        assert!(db::list_documents(&conn).unwrap().is_empty());

        let fake = write_source(&library.root.join("source"), "fake.pdf", b"not a pdf");
        let err = import_pdf(&fake, &library.documents(), &conn).unwrap_err();
        assert!(err.contains("не является PDF"));
        assert!(std::fs::read_dir(library.documents()).unwrap().next().is_none());
        assert!(db::list_documents(&conn).unwrap().is_empty());
        assert_eq!(std::fs::read(&fake).unwrap(), b"not a pdf");
    }

    #[test]
    fn copy_failure_does_not_create_a_row() {
        let library = TempLibrary::new();
        let source = write_source(&library.root.join("source"), "book.pdf", b"%PDF-1.4\n");
        let blocked = library.root.join("blocked");
        std::fs::write(&blocked, b"file").unwrap();
        let conn = library.database();

        let err = import_pdf(&source, &blocked, &conn).unwrap_err();
        assert!(err.contains("каталог") || err.contains("скопировать"));
        assert!(db::list_documents(&conn).unwrap().is_empty());
        assert_eq!(std::fs::read(&source).unwrap(), b"%PDF-1.4\n");
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        to_hex(&Sha256::digest(bytes))
    }
}

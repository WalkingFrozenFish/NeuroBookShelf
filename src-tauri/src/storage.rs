use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::db::{self, Document};

pub fn trash_document(
    conn: &Connection,
    id: i64,
    documents_dir: &Path,
    trash_dir: &Path,
) -> Result<(), String> {
    let document = db::get_document(conn, id)?;
    if document.deleted_at.is_some() {
        return Err("Документ уже в корзине".to_string());
    }
    let moved = relocate_library_file(&document, documents_dir, trash_dir)?;
    if let Err(err) = db::mark_trashed(
        conn,
        id,
        moved.as_ref().map(|file| file.path.as_str()),
        moved.as_ref().map(|file| file.name.as_str()),
    ) {
        if let Some(file) = moved {
            undo_move(&file, &err)?;
        }
        return Err(err);
    }
    Ok(())
}

pub fn restore_document(
    conn: &Connection,
    id: i64,
    documents_dir: &Path,
    trash_dir: &Path,
) -> Result<Document, String> {
    let document = db::get_document(conn, id)?;
    if document.deleted_at.is_none() {
        return Err("Документ не находится в корзине".to_string());
    }
    let moved = relocate_library_file(&document, trash_dir, documents_dir)?;
    match db::mark_restored(
        conn,
        id,
        moved.as_ref().map(|file| file.path.as_str()),
        moved.as_ref().map(|file| file.name.as_str()),
    ) {
        Ok(document) => Ok(document),
        Err(err) => {
            if let Some(file) = moved {
                undo_move(&file, &err)?;
            }
            Err(err)
        }
    }
}

pub fn purge_document(conn: &Connection, id: i64, trash_dir: &Path) -> Result<(), String> {
    let document = db::get_document(conn, id)?;
    if document.deleted_at.is_none() {
        return Err("Документ не находится в корзине".to_string());
    }
    if let Some(path) = document.path.as_deref() {
        delete_trashed_file(trash_dir, Path::new(path))?;
    }
    db::delete_document(conn, id)
}

pub fn library_pdf_path(documents_dir: &Path, document: &Document) -> Result<PathBuf, String> {
    if document.deleted_at.is_some() {
        return Err("Документ находится в корзине".to_string());
    }
    let stored = document
        .path
        .as_deref()
        .ok_or_else(|| "У документа нет PDF".to_string())?;
    file_inside(
        documents_dir,
        Path::new(stored),
        "Можно открыть только PDF из библиотеки",
    )
}

pub fn read_library_pdf(documents_dir: &Path, document: &Document) -> Result<Vec<u8>, String> {
    let file = library_pdf_path(documents_dir, document)?;
    fs::read(&file).map_err(|err| format!("Не удалось прочитать PDF: {err}"))
}

pub fn export_pdf(
    documents_dir: &Path,
    source: &Path,
    destination_dir: &Path,
    file_name: &str,
) -> Result<PathBuf, String> {
    let source = file_inside(documents_dir, source, "Можно экспортировать только PDF из библиотеки")?;
    let file_name = plain_file_name(file_name, "Не удалось определить имя файла для экспорта")?;
    if !destination_dir.is_dir() {
        return Err("Папка назначения недоступна".to_string());
    }
    let destination = destination_dir.join(&file_name);
    if destination.exists() {
        return Err(occupied_message(&file_name));
    }
    let mut input = File::open(&source).map_err(|err| format!("Не удалось открыть PDF: {err}"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::AlreadyExists {
                occupied_message(&file_name)
            } else {
                format!("Не удалось скопировать PDF: {err}")
            }
        })?;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = match input.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(err) => {
                return Err(abort_new_file(
                    &destination,
                    format!("Не удалось прочитать PDF: {err}"),
                ));
            }
        };
        if let Err(err) = output.write_all(&buffer[..read]) {
            return Err(abort_new_file(
                &destination,
                format!("Не удалось скопировать PDF: {err}"),
            ));
        }
    }
    if let Err(err) = output.sync_all() {
        return Err(abort_new_file(
            &destination,
            format!("Не удалось сохранить экспортированный PDF: {err}"),
        ));
    }
    Ok(destination)
}

struct MovedFile {
    path: String,
    name: String,
    previous: PathBuf,
}

fn relocate_library_file(
    document: &Document,
    source_dir: &Path,
    destination_dir: &Path,
) -> Result<Option<MovedFile>, String> {
    let Some(stored) = document.path.as_deref() else {
        return Ok(None);
    };
    let source = file_inside(source_dir, Path::new(stored), "Файл документа находится вне библиотеки")?;
    let preferred = document
        .internal_filename
        .as_deref()
        .ok_or_else(|| "У документа нет внутреннего имени файла".to_string())?;
    plain_file_name(preferred, "Некорректное внутреннее имя файла")?;
    if source.file_name().and_then(|name| name.to_str()) != Some(preferred) {
        return Err("Имя файла документа не совпадает с записью".to_string());
    }
    fs::create_dir_all(destination_dir)
        .map_err(|err| format!("Не удалось создать каталог: {err}"))?;
    let name = available_name(destination_dir, preferred)?;
    let destination = destination_dir.join(&name);
    fs::rename(&source, &destination).map_err(|err| format!("Не удалось переместить PDF: {err}"))?;
    Ok(Some(MovedFile {
        path: destination.display().to_string(),
        name,
        previous: source,
    }))
}

fn available_name(directory: &Path, preferred: &str) -> Result<String, String> {
    if !directory.join(preferred).exists() {
        return Ok(preferred.to_string());
    }
    for _ in 0..10 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Не удалось выбрать имя файла".to_string())?
            .as_nanos();
        let name = format!("{nanos}.pdf");
        if !directory.join(&name).exists() {
            return Ok(name);
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    Err("В каталоге уже есть файл с таким именем, перезапись отменена".to_string())
}

fn delete_trashed_file(trash_dir: &Path, stored: &Path) -> Result<(), String> {
    if !stored.exists() {
        return Ok(());
    }
    let file = file_inside(trash_dir, stored, "Можно удалить только файл из корзины")?;
    if !file.is_file() {
        return Err("Можно удалить только файл из корзины".to_string());
    }
    fs::remove_file(file).map_err(|err| format!("Не удалось удалить PDF: {err}"))
}

fn file_inside(root: &Path, file: &Path, message: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|err| format!("Не удалось открыть каталог: {err}"))?;
    let file = fs::canonicalize(file).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "Файл документа не найден".to_string()
        } else {
            format!("Не удалось открыть файл: {err}")
        }
    })?;
    if file.starts_with(&root) && file != root {
        Ok(file)
    } else {
        Err(message.to_string())
    }
}

fn plain_file_name(name: &str, message: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let file_name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if trimmed.is_empty()
        || file_name != trimmed
        || file_name == "."
        || file_name == ".."
        || file_name.contains(['/', '\\'])
    {
        return Err(message.to_string());
    }
    Ok(file_name.to_string())
}

fn occupied_message(file_name: &str) -> String {
    format!("В выбранной папке уже есть файл «{file_name}». Он не был перезаписан.")
}

fn undo_move(file: &MovedFile, err: &str) -> Result<(), String> {
    if let Err(undo) = fs::rename(&file.path, &file.previous) {
        return Err(format!("{err}. Не удалось вернуть PDF на место: {undo}"));
    }
    Ok(())
}

fn abort_new_file(destination: &Path, message: String) -> String {
    if let Err(err) = fs::remove_file(destination) {
        if err.kind() != std::io::ErrorKind::NotFound {
            return format!("{message}. Не удалось удалить незавершённую копию: {err}");
        }
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;
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
            let root = std::env::temp_dir().join(format!("llr-storage-{nanos}-{n}"));
            fs::create_dir_all(root.join("documents")).unwrap();
            fs::create_dir_all(root.join("trash")).unwrap();
            Self { root }
        }

        fn documents(&self) -> PathBuf {
            self.root.join("documents")
        }

        fn trash(&self) -> PathBuf {
            self.root.join("trash")
        }

        fn database(&self) -> Connection {
            db::open(&self.root.join("library.db")).unwrap()
        }
    }

    impl Drop for TempLibrary {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn store_pdf(library: &TempLibrary, name: &str, bytes: &[u8]) -> Document {
        let path = library.documents().join(name);
        fs::write(&path, bytes).unwrap();
        let conn = library.database();
        db::insert_imported_document(&conn, "Книга", "book.pdf", name, &path, bytes.len() as i64, "abc")
            .unwrap()
    }

    #[test]
    fn trash_and_restore_keep_links_and_file_bytes() {
        let library = TempLibrary::new();
        let bytes = b"%PDF-1.4\nstage5\n";
        let conn = library.database();
        let shelf = db::create_shelf(&conn, "Наука").unwrap();
        let tag = db::create_tag(&conn, "важное").unwrap();
        let document = store_pdf(&library, "100.pdf", bytes);
        db::update_document(&conn, document.id, "Книга", &[shelf.id], &[tag.id]).unwrap();

        trash_document(&conn, document.id, &library.documents(), &library.trash()).unwrap();

        assert!(db::list_documents(&conn).unwrap().is_empty());
        assert!(!library.documents().join("100.pdf").exists());
        assert_eq!(fs::read(library.trash().join("100.pdf")).unwrap(), bytes);
        let trashed = db::list_trash(&conn).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].shelf_ids, vec![shelf.id]);
        assert_eq!(trashed[0].tag_ids, vec![tag.id]);
        assert!(trashed[0].deleted_at.is_some());
        assert_eq!(trashed[0].original_filename.as_deref(), Some("book.pdf"));
        assert_eq!(trashed[0].hash.as_deref(), Some("abc"));

        let restored =
            restore_document(&conn, document.id, &library.documents(), &library.trash()).unwrap();
        assert!(restored.deleted_at.is_none());
        assert_eq!(restored.shelf_ids, vec![shelf.id]);
        assert_eq!(restored.tag_ids, vec![tag.id]);
        assert_eq!(restored.original_filename.as_deref(), Some("book.pdf"));
        assert_eq!(restored.hash.as_deref(), Some("abc"));
        assert_eq!(fs::read(library.documents().join("100.pdf")).unwrap(), bytes);
        assert!(db::list_trash(&conn).unwrap().is_empty());
        assert_eq!(db::list_documents(&conn).unwrap().len(), 1);
    }

    #[test]
    fn restore_does_not_overwrite_an_existing_file() {
        let library = TempLibrary::new();
        let bytes = b"%PDF-1.4\noriginal\n";
        let conn = library.database();
        let document = store_pdf(&library, "100.pdf", bytes);
        trash_document(&conn, document.id, &library.documents(), &library.trash()).unwrap();
        let occupant = b"keep-me";
        fs::write(library.documents().join("100.pdf"), occupant).unwrap();

        let restored =
            restore_document(&conn, document.id, &library.documents(), &library.trash()).unwrap();

        assert_eq!(fs::read(library.documents().join("100.pdf")).unwrap(), occupant);
        let restored_name = restored.internal_filename.unwrap();
        assert_ne!(restored_name, "100.pdf");
        assert_eq!(
            fs::read(library.documents().join(&restored_name)).unwrap(),
            bytes
        );
        assert!(restored.deleted_at.is_none());
    }

    #[test]
    fn trash_does_not_overwrite_an_existing_trash_file() {
        let library = TempLibrary::new();
        let bytes = b"%PDF-1.4\nmove-me\n";
        let conn = library.database();
        let document = store_pdf(&library, "100.pdf", bytes);
        let occupant = b"already-there";
        fs::write(library.trash().join("100.pdf"), occupant).unwrap();

        trash_document(&conn, document.id, &library.documents(), &library.trash()).unwrap();

        assert_eq!(fs::read(library.trash().join("100.pdf")).unwrap(), occupant);
        assert!(!library.documents().join("100.pdf").exists());
        let trashed = &db::list_trash(&conn).unwrap()[0];
        let name = trashed.internal_filename.clone().unwrap();
        assert_ne!(name, "100.pdf");
        assert_eq!(fs::read(library.trash().join(name)).unwrap(), bytes);
    }

    #[test]
    fn purge_deletes_only_the_trashed_file_and_row() {
        let library = TempLibrary::new();
        let conn = library.database();
        let shelf = db::create_shelf(&conn, "Архив").unwrap();
        let document = store_pdf(&library, "100.pdf", b"%PDF-1.4\n");
        db::update_document(&conn, document.id, "Книга", &[shelf.id], &[]).unwrap();
        trash_document(&conn, document.id, &library.documents(), &library.trash()).unwrap();
        fs::write(library.trash().join("other.pdf"), b"other").unwrap();

        purge_document(&conn, document.id, &library.trash()).unwrap();

        assert!(!library.trash().join("100.pdf").exists());
        assert_eq!(fs::read(library.trash().join("other.pdf")).unwrap(), b"other");
        assert!(db::list_trash(&conn).unwrap().is_empty());
        assert!(db::list_documents(&conn).unwrap().is_empty());
        assert_eq!(db::list_shelves(&conn).unwrap()[0].name, "Архив");
    }

    #[test]
    fn purge_refuses_a_file_outside_trash() {
        let library = TempLibrary::new();
        let conn = library.database();
        let document = store_pdf(&library, "100.pdf", b"%PDF-1.4\nsafe\n");
        conn.execute(
            "UPDATE documents SET deleted_at = datetime('now') WHERE id = ?1",
            [document.id],
        )
        .unwrap();

        let err = purge_document(&conn, document.id, &library.trash()).unwrap_err();

        assert!(err.contains("корзины"));
        assert_eq!(fs::read(library.documents().join("100.pdf")).unwrap(), b"%PDF-1.4\nsafe\n");
        assert_eq!(db::list_trash(&conn).unwrap().len(), 1);
    }

    #[test]
    fn export_copies_without_changing_or_overwriting() {
        let library = TempLibrary::new();
        let bytes = b"%PDF-1.4\nexport\n";
        let document = store_pdf(&library, "100.pdf", bytes);
        let source = library.documents().join("100.pdf");
        let destination_dir = library.root.join("export");
        fs::create_dir_all(&destination_dir).unwrap();

        let copied = export_pdf(
            &library.documents(),
            &source,
            &destination_dir,
            document.original_filename.as_deref().unwrap(),
        )
        .unwrap();

        assert_eq!(copied.file_name().unwrap(), "book.pdf");
        assert_eq!(fs::read(&copied).unwrap(), bytes);
        assert_eq!(fs::read(&source).unwrap(), bytes);

        fs::write(&copied, b"keep-export").unwrap();
        let err = export_pdf(
            &library.documents(),
            &source,
            &destination_dir,
            "book.pdf",
        )
        .unwrap_err();
        assert!(err.contains("не был перезаписан"));
        assert_eq!(fs::read(&copied).unwrap(), b"keep-export");
        assert_eq!(fs::read(&source).unwrap(), bytes);
    }

    #[test]
    fn export_reports_a_copy_error_without_touching_the_source() {
        let library = TempLibrary::new();
        let document = store_pdf(&library, "100.pdf", b"%PDF-1.4\n");
        let source = library.documents().join("100.pdf");
        let blocked = library.root.join("not-a-directory");
        fs::write(&blocked, b"file").unwrap();

        let err = export_pdf(&library.documents(), &source, &blocked, "book.pdf").unwrap_err();

        assert!(err.contains("недоступна"));
        assert_eq!(fs::read(&source).unwrap(), b"%PDF-1.4\n");
        let _ = document;
    }

    #[test]
    fn read_returns_library_bytes_and_reports_a_missing_file() {
        let library = TempLibrary::new();
        let bytes = b"%PDF-1.4\nread-me\n";
        let document = store_pdf(&library, "100.pdf", bytes);
        let conn = library.database();

        let read = read_library_pdf(&library.documents(), &document).unwrap();
        assert_eq!(read, bytes);

        fs::remove_file(library.documents().join("100.pdf")).unwrap();
        let err = read_library_pdf(&library.documents(), &document).unwrap_err();
        assert!(err.contains("не найден"));

        trash_document(&conn, document.id, &library.documents(), &library.trash()).unwrap_err();
        conn.execute(
            "UPDATE documents SET deleted_at = datetime('now') WHERE id = ?1",
            [document.id],
        )
        .unwrap();
        let trashed = db::get_document(&conn, document.id).unwrap();
        let err = read_library_pdf(&library.documents(), &trashed).unwrap_err();
        assert!(err.contains("корзине"));
    }
}

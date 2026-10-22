use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub original_filename: Option<String>,
    pub internal_filename: Option<String>,
    pub path: Option<String>,
    pub file_size: Option<i64>,
    pub hash: Option<String>,
    pub shelf_ids: Vec<i64>,
    pub tag_ids: Vec<i64>,
    pub deleted_at: Option<String>,
    pub last_page: i64,
    pub last_zoom: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Не удалось создать каталог базы: {err}"))?;
    }
    let conn = Connection::open(path).map_err(|err| format!("Не удалось открыть SQLite: {err}"))?;
    conn.pragma_update(None, "foreign_keys", 1)
        .map_err(|err| format!("Не удалось включить внешние ключи: {err}"))?;
    migrate(&conn)?;
    Ok(conn)
}

const DOCUMENT_SELECT: &str = "SELECT d.id, d.title, d.created_at, d.updated_at,
       d.original_filename, d.internal_filename, d.path, d.file_size, d.hash,
       (SELECT group_concat(shelf_id) FROM document_shelves WHERE document_id = d.id),
       (SELECT group_concat(tag_id) FROM document_tags WHERE document_id = d.id),
       d.deleted_at, d.last_page, d.last_zoom
FROM documents d";

pub fn rebase_portable_paths(
    conn: &Connection,
    documents: &Path,
    trash: &Path,
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    let rows = {
        let mut statement = tx.prepare("SELECT id, internal_filename, deleted_at IS NOT NULL FROM documents WHERE internal_filename IS NOT NULL").map_err(sql_error)?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?
    };
    for (id, name, deleted) in rows {
        if Path::new(&name).components().count() != 1
            || Path::new(&name).file_name().and_then(|part| part.to_str()) != Some(&name)
        {
            return Err("Недопустимое имя файла в переносимой библиотеке".to_string());
        }
        let path = if deleted { trash } else { documents }.join(name);
        tx.execute(
            "UPDATE documents SET path = ?1 WHERE id = ?2",
            params![path.to_string_lossy(), id],
        )
        .map_err(sql_error)?;
    }
    tx.commit().map_err(sql_error)
}

pub fn list_documents(conn: &Connection) -> Result<Vec<Document>, String> {
    list_documents_filtered(
        conn,
        "WHERE d.deleted_at IS NULL",
        "ORDER BY d.title COLLATE NOCASE, d.id",
    )
}

pub fn list_trash(conn: &Connection) -> Result<Vec<Document>, String> {
    list_documents_filtered(
        conn,
        "WHERE d.deleted_at IS NOT NULL",
        "ORDER BY d.deleted_at DESC, d.id",
    )
}

fn list_documents_filtered(
    conn: &Connection,
    filter: &str,
    order: &str,
) -> Result<Vec<Document>, String> {
    let sql = format!("{DOCUMENT_SELECT} {filter} {order}");
    let mut statement = conn.prepare(&sql).map_err(sql_error)?;
    let rows = statement.query_map([], map_document).map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

pub fn create_document(
    conn: &Connection,
    title: &str,
    shelf_ids: &[i64],
    tag_ids: &[i64],
) -> Result<Document, String> {
    let title = required_text(title, "Название")?;
    let shelf_ids = unique_ids(shelf_ids);
    let tag_ids = unique_ids(tag_ids);
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    ensure_ids(&tx, "shelves", &shelf_ids, "Полка", "не найдена")?;
    ensure_ids(&tx, "tags", &tag_ids, "Тег", "не найден")?;
    tx.execute("INSERT INTO documents (title) VALUES (?1)", [&title])
        .map_err(sql_error)?;
    let id = tx.last_insert_rowid();
    insert_links(&tx, id, &shelf_ids, &tag_ids)?;
    let document = get_document(&tx, id)?;
    tx.commit().map_err(sql_error)?;
    Ok(document)
}

pub fn insert_imported_document(
    conn: &Connection,
    title: &str,
    original_filename: &str,
    internal_filename: &str,
    path: &Path,
    file_size: i64,
    hash: &str,
) -> Result<Document, String> {
    let title = required_text(title, "Название")?;
    conn.execute(
        "INSERT INTO documents (
            title, original_filename, internal_filename, path, file_size, hash
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            title,
            original_filename,
            internal_filename,
            path.display().to_string(),
            file_size,
            hash
        ],
    )
    .map_err(sql_error)?;
    get_document(conn, conn.last_insert_rowid())
}

pub fn update_document(
    conn: &Connection,
    id: i64,
    title: &str,
    shelf_ids: &[i64],
    tag_ids: &[i64],
) -> Result<Document, String> {
    let title = required_text(title, "Название")?;
    let shelf_ids = unique_ids(shelf_ids);
    let tag_ids = unique_ids(tag_ids);
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    ensure_ids(&tx, "shelves", &shelf_ids, "Полка", "не найдена")?;
    ensure_ids(&tx, "tags", &tag_ids, "Тег", "не найден")?;
    let updated = tx
        .execute(
            "UPDATE documents SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![title, id],
        )
        .map_err(sql_error)?;
    if updated == 0 {
        return Err("Документ не найден".to_string());
    }
    tx.execute("DELETE FROM document_shelves WHERE document_id = ?1", [id])
        .map_err(sql_error)?;
    tx.execute("DELETE FROM document_tags WHERE document_id = ?1", [id])
        .map_err(sql_error)?;
    insert_links(&tx, id, &shelf_ids, &tag_ids)?;
    let document = get_document(&tx, id)?;
    tx.commit().map_err(sql_error)?;
    Ok(document)
}

pub fn mark_trashed(
    conn: &Connection,
    id: i64,
    path: Option<&str>,
    internal_filename: Option<&str>,
) -> Result<(), String> {
    let updated = conn
        .execute(
            "UPDATE documents
             SET deleted_at = datetime('now'),
                 updated_at = datetime('now'),
                 path = CASE WHEN ?1 IS NULL THEN path ELSE ?1 END,
                 internal_filename = CASE WHEN ?2 IS NULL THEN internal_filename ELSE ?2 END
             WHERE id = ?3 AND deleted_at IS NULL",
            params![path, internal_filename, id],
        )
        .map_err(sql_error)?;
    if updated == 0 {
        return trash_state_error(conn, id, true);
    }
    Ok(())
}

pub fn mark_restored(
    conn: &Connection,
    id: i64,
    path: Option<&str>,
    internal_filename: Option<&str>,
) -> Result<Document, String> {
    let updated = conn
        .execute(
            "UPDATE documents
             SET deleted_at = NULL,
                 updated_at = datetime('now'),
                 path = CASE WHEN ?1 IS NULL THEN path ELSE ?1 END,
                 internal_filename = CASE WHEN ?2 IS NULL THEN internal_filename ELSE ?2 END
             WHERE id = ?3 AND deleted_at IS NOT NULL",
            params![path, internal_filename, id],
        )
        .map_err(sql_error)?;
    if updated == 0 {
        return Err(trash_state_error(conn, id, false).unwrap_err());
    }
    get_document(conn, id)
}

fn trash_state_error(conn: &Connection, id: i64, expect_active: bool) -> Result<(), String> {
    match get_document(conn, id) {
        Ok(document) if document.deleted_at.is_some() && expect_active => {
            Err("Документ уже в корзине".to_string())
        }
        Ok(document) if document.deleted_at.is_none() && !expect_active => {
            Err("Документ не находится в корзине".to_string())
        }
        Ok(_) => Err("Не удалось обновить документ".to_string()),
        Err(err) => Err(err),
    }
}

pub fn save_reading_state(conn: &Connection, id: i64, page: i64, zoom: &str) -> Result<(), String> {
    if page < 1 {
        return Err("Некорректный номер страницы".to_string());
    }
    let zoom = normalize_zoom(zoom)?;
    let updated = conn
        .execute(
            "UPDATE documents SET last_page = ?1, last_zoom = ?2
             WHERE id = ?3 AND deleted_at IS NULL",
            params![page, zoom, id],
        )
        .map_err(sql_error)?;
    if updated == 0 {
        return Err(match get_document(conn, id) {
            Ok(document) if document.deleted_at.is_some() => {
                "Документ находится в корзине".to_string()
            }
            Ok(_) => "Не удалось сохранить страницу".to_string(),
            Err(err) => err,
        });
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub document_id: i64,
    pub page_number: i64,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub document_id: i64,
    pub page_number: Option<i64>,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_bookmarks(conn: &Connection, document_id: i64) -> Result<Vec<Bookmark>, String> {
    ensure_active_document(conn, document_id)?;
    let mut statement = conn
        .prepare(
            "SELECT id, document_id, page_number, label, created_at
             FROM bookmarks WHERE document_id = ?1 ORDER BY page_number, id",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([document_id], map_bookmark)
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

pub fn create_bookmark(
    conn: &Connection,
    document_id: i64,
    page_number: i64,
    label: &str,
) -> Result<Bookmark, String> {
    ensure_active_document(conn, document_id)?;
    let page_number = page_number_value(page_number)?;
    let label = short_label(label)?;
    conn.execute(
        "INSERT INTO bookmarks (document_id, page_number, label) VALUES (?1, ?2, ?3)",
        params![document_id, page_number, label],
    )
    .map_err(sql_error)?;
    bookmark_by_id(conn, conn.last_insert_rowid())
}

pub fn delete_bookmark(conn: &Connection, id: i64) -> Result<(), String> {
    let deleted = conn
        .execute("DELETE FROM bookmarks WHERE id = ?1", [id])
        .map_err(sql_error)?;
    if deleted == 0 {
        return Err("Закладка не найдена".to_string());
    }
    Ok(())
}

pub fn list_notes(conn: &Connection, document_id: i64) -> Result<Vec<Note>, String> {
    ensure_active_document(conn, document_id)?;
    let mut statement = conn
        .prepare(
            "SELECT id, document_id, page_number, body, created_at, updated_at
             FROM notes WHERE document_id = ?1
             ORDER BY page_number IS NOT NULL, page_number, id",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([document_id], map_note)
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

pub fn create_note(
    conn: &Connection,
    document_id: i64,
    page_number: Option<i64>,
    body: &str,
) -> Result<Note, String> {
    ensure_active_document(conn, document_id)?;
    let page_number = optional_page(page_number)?;
    let body = note_body(body)?;
    conn.execute(
        "INSERT INTO notes (document_id, page_number, body) VALUES (?1, ?2, ?3)",
        params![document_id, page_number, body],
    )
    .map_err(sql_error)?;
    note_by_id(conn, conn.last_insert_rowid())
}

pub fn update_note(conn: &Connection, id: i64, body: &str) -> Result<Note, String> {
    let body = note_body(body)?;
    let updated = conn
        .execute(
            "UPDATE notes SET body = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![body, id],
        )
        .map_err(sql_error)?;
    if updated == 0 {
        return Err("Заметка не найдена".to_string());
    }
    note_by_id(conn, id)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub id: i64,
    pub dictionary_id: i64,
    pub source_text: String,
    pub translated_text: String,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_dictionary_entries(
    conn: &Connection,
    scope: &str,
    document_id: Option<i64>,
    query: &str,
) -> Result<Vec<DictionaryEntry>, String> {
    let dictionary_id = dictionary_for(conn, scope, document_id)?;
    let mut entries = dictionary_rows(conn, dictionary_id)?;
    let query = query.trim().to_lowercase();
    if !query.is_empty() {
        entries.retain(|entry| {
            starts_with_word(&entry.source_text.to_lowercase(), &query)
                || starts_with_word(&entry.translated_text.to_lowercase(), &query)
        });
    }
    entries.sort_by(|left, right| {
        left.source_text
            .to_lowercase()
            .cmp(&right.source_text.to_lowercase())
            .then(left.id.cmp(&right.id))
    });
    Ok(entries)
}

pub fn create_dictionary_entry(
    conn: &Connection,
    scope: &str,
    document_id: Option<i64>,
    source_text: &str,
    translated_text: &str,
    note: &str,
) -> Result<DictionaryEntry, String> {
    let dictionary_id = dictionary_for(conn, scope, document_id)?;
    let source_text = dictionary_phrase(source_text, "Слово или фраза")?;
    let translated_text = dictionary_phrase(translated_text, "Перевод")?;
    let note = dictionary_note(note)?;
    conn.execute(
        "INSERT INTO dictionary_entries (dictionary_id, source_text, translated_text, note)
         VALUES (?1, ?2, ?3, ?4)",
        params![dictionary_id, source_text, translated_text, note],
    )
    .map_err(sql_error)?;
    dictionary_entry_by_id(conn, conn.last_insert_rowid())
}

pub fn update_dictionary_entry(
    conn: &Connection,
    id: i64,
    source_text: &str,
    translated_text: &str,
    note: &str,
) -> Result<DictionaryEntry, String> {
    ensure_entry_writable(conn, id)?;
    let source_text = dictionary_phrase(source_text, "Слово или фраза")?;
    let translated_text = dictionary_phrase(translated_text, "Перевод")?;
    let note = dictionary_note(note)?;
    conn.execute(
        "UPDATE dictionary_entries
         SET source_text = ?1, translated_text = ?2, note = ?3, updated_at = datetime('now')
         WHERE id = ?4",
        params![source_text, translated_text, note, id],
    )
    .map_err(sql_error)?;
    dictionary_entry_by_id(conn, id)
}

pub fn delete_dictionary_entry(conn: &Connection, id: i64) -> Result<(), String> {
    ensure_entry_writable(conn, id)?;
    let deleted = conn
        .execute("DELETE FROM dictionary_entries WHERE id = ?1", [id])
        .map_err(sql_error)?;
    if deleted == 0 {
        return Err("Запись словаря не найдена".to_string());
    }
    Ok(())
}

pub fn delete_note(conn: &Connection, id: i64) -> Result<(), String> {
    let deleted = conn
        .execute("DELETE FROM notes WHERE id = ?1", [id])
        .map_err(sql_error)?;
    if deleted == 0 {
        return Err("Заметка не найдена".to_string());
    }
    Ok(())
}

pub fn delete_document_notes(conn: &Connection, document_id: i64) -> Result<(), String> {
    ensure_active_document(conn, document_id)?;
    conn.execute("DELETE FROM notes WHERE document_id = ?1", [document_id])
        .map_err(sql_error)?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationBlock {
    pub id: i64,
    pub document_id: i64,
    pub page_number: i64,
    pub source_x: f64,
    pub source_y: f64,
    pub source_width: f64,
    pub source_height: f64,
    pub ocr_text: String,
    pub translated_text: String,
    pub created_at: String,
    pub updated_at: String,
    pub popup_x: Option<f64>,
    pub popup_y: Option<f64>,
    pub popup_width: Option<f64>,
    pub popup_height: Option<f64>,
}

const BLOCK_COLUMNS: &str =
    "id, document_id, page_number, source_x, source_y, source_width, source_height,
                    ocr_text,
                    COALESCE((SELECT translated_text FROM translation_versions
                              WHERE translation_block_id = translation_blocks.id AND is_active = 1),
                             translated_text),
                    created_at, updated_at,
                    popup_x, popup_y, popup_width, popup_height";

pub fn list_translation_blocks(
    conn: &Connection,
    document_id: i64,
    page_number: i64,
) -> Result<Vec<TranslationBlock>, String> {
    ensure_active_document(conn, document_id)?;
    let page_number = page_number_value(page_number)?;
    let mut statement = conn
        .prepare(&format!(
            "SELECT {BLOCK_COLUMNS}
                 FROM translation_blocks
                 WHERE document_id = ?1 AND page_number = ?2
                 ORDER BY id"
        ))
        .map_err(sql_error)?;
    let rows = statement
        .query_map(params![document_id, page_number], map_translation_block)
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

pub fn create_translation_block(
    conn: &Connection,
    document_id: i64,
    page_number: i64,
    source_x: f64,
    source_y: f64,
    source_width: f64,
    source_height: f64,
    ocr_text: &str,
    translated_text: &str,
    translator: &str,
) -> Result<TranslationBlock, String> {
    ensure_active_document(conn, document_id)?;
    let page_number = page_number_value(page_number)?;
    let (source_x, source_y, source_width, source_height) =
        source_rect(source_x, source_y, source_width, source_height)?;
    let ocr_text = block_text(ocr_text, "Исходный текст")?;
    let translated_text = block_text(translated_text, "Перевод")?;
    let translator = translator_name(translator)?;
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    tx.execute(
        "INSERT INTO translation_blocks (
            document_id, page_number, source_x, source_y, source_width, source_height,
            ocr_text, translated_text
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            document_id,
            page_number,
            source_x,
            source_y,
            source_width,
            source_height,
            ocr_text,
            translated_text
        ],
    )
    .map_err(sql_error)?;
    let id = tx.last_insert_rowid();
    insert_active_version(&tx, id, &translated_text, &translator)?;
    tx.commit().map_err(sql_error)?;
    translation_block_by_id(conn, id)
}

pub fn update_translation_block(
    conn: &Connection,
    id: i64,
    ocr_text: &str,
    translated_text: &str,
) -> Result<TranslationBlock, String> {
    let current = translation_block_by_id(conn, id)?;
    ensure_active_document(conn, current.document_id)?;
    let ocr_text = block_text(ocr_text, "Исходный текст")?;
    let translated_text = block_text(translated_text, "Перевод")?;
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    if ocr_text != current.ocr_text {
        tx.execute(
            "UPDATE translation_blocks SET ocr_text = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![ocr_text, id],
        )
        .map_err(sql_error)?;
    }
    if translated_text != current.translated_text {
        insert_active_version(&tx, id, &translated_text, "manual")?;
    }
    tx.commit().map_err(sql_error)?;
    translation_block_by_id(conn, id)
}

pub fn translation_block_ocr(conn: &Connection, id: i64) -> Result<String, String> {
    let block = translation_block_by_id(conn, id)?;
    ensure_active_document(conn, block.document_id)?;
    Ok(block.ocr_text)
}

pub fn add_translation_version(
    conn: &Connection,
    id: i64,
    translated_text: &str,
    translator: &str,
) -> Result<TranslationBlock, String> {
    let current = translation_block_by_id(conn, id)?;
    ensure_active_document(conn, current.document_id)?;
    let translated_text = block_text(translated_text, "Перевод")?;
    let translator = translator_name(translator)?;
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    insert_active_version(&tx, id, &translated_text, &translator)?;
    tx.commit().map_err(sql_error)?;
    translation_block_by_id(conn, id)
}

pub fn update_translation_popup(
    conn: &Connection,
    id: i64,
    popup_x: f64,
    popup_y: f64,
    popup_width: f64,
    popup_height: f64,
) -> Result<TranslationBlock, String> {
    let current = translation_block_by_id(conn, id)?;
    ensure_active_document(conn, current.document_id)?;
    let (popup_x, popup_y, popup_width, popup_height) =
        popup_rect(popup_x, popup_y, popup_width, popup_height)?;
    conn.execute(
        "UPDATE translation_blocks
         SET popup_x = ?1, popup_y = ?2, popup_width = ?3, popup_height = ?4, updated_at = datetime('now')
         WHERE id = ?5",
        params![popup_x, popup_y, popup_width, popup_height, id],
    )
    .map_err(sql_error)?;
    translation_block_by_id(conn, id)
}

pub fn list_translation_versions(
    conn: &Connection,
    block_id: i64,
) -> Result<Vec<TranslationVersion>, String> {
    let block = translation_block_by_id(conn, block_id)?;
    ensure_active_document(conn, block.document_id)?;
    let mut statement = conn
        .prepare(
            "SELECT id, translation_block_id, translated_text, translator, created_at, is_active
             FROM translation_versions
             WHERE translation_block_id = ?1
             ORDER BY id DESC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([block_id], map_translation_version)
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

pub fn activate_translation_version(
    conn: &Connection,
    version_id: i64,
) -> Result<TranslationBlock, String> {
    let version = translation_version_by_id(conn, version_id)?;
    let block = translation_block_by_id(conn, version.translation_block_id)?;
    ensure_active_document(conn, block.document_id)?;
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    tx.execute(
        "UPDATE translation_versions SET is_active = 0 WHERE translation_block_id = ?1",
        [block.id],
    )
    .map_err(sql_error)?;
    tx.execute(
        "UPDATE translation_versions SET is_active = 1 WHERE id = ?1",
        [version_id],
    )
    .map_err(sql_error)?;
    tx.execute(
        "UPDATE translation_blocks SET translated_text = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![version.translated_text, block.id],
    )
    .map_err(sql_error)?;
    tx.commit().map_err(sql_error)?;
    translation_block_by_id(conn, block.id)
}

pub fn delete_translation_block(conn: &Connection, id: i64) -> Result<(), String> {
    let deleted = conn
        .execute("DELETE FROM translation_blocks WHERE id = ?1", [id])
        .map_err(sql_error)?;
    if deleted == 0 {
        return Err("Перевод не найден".to_string());
    }
    Ok(())
}

pub fn delete_document_translations(conn: &Connection, document_id: i64) -> Result<(), String> {
    ensure_active_document(conn, document_id)?;
    conn.execute(
        "DELETE FROM translation_blocks WHERE document_id = ?1",
        [document_id],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn source_rect(x: f64, y: f64, width: f64, height: f64) -> Result<(f64, f64, f64, f64), String> {
    if ![x, y, width, height].iter().all(|value| value.is_finite()) {
        return Err("Некорректная область".to_string());
    }
    if width <= 0.0 || height <= 0.0 || x < 0.0 || y < 0.0 || x > 1.0 || y > 1.0 {
        return Err("Некорректная область".to_string());
    }
    if x + width > 1.001 || y + height > 1.001 {
        return Err("Некорректная область".to_string());
    }
    let x = round4(x);
    let y = round4(y);
    let width = round4(width.min(1.0 - x));
    let height = round4(height.min(1.0 - y));
    if width <= 0.0 || height <= 0.0 {
        return Err("Некорректная область".to_string());
    }
    Ok((x, y, width, height))
}

fn popup_rect(x: f64, y: f64, width: f64, height: f64) -> Result<(f64, f64, f64, f64), String> {
    if ![x, y, width, height].iter().all(|value| value.is_finite()) {
        return Err("Некорректное положение карточки".to_string());
    }
    if width <= 0.0 || height <= 0.0 {
        return Err("Некорректное положение карточки".to_string());
    }
    let width = round4(width.clamp(0.08, 1.0));
    let height = round4(height.clamp(0.06, 1.0));
    let x = round4(x.clamp(0.0, 1.0 - width));
    let y = round4(y.clamp(0.0, 1.0 - height));
    Ok((x, y, width, height))
}

fn insert_active_version(
    conn: &Connection,
    block_id: i64,
    translated_text: &str,
    translator: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE translation_versions SET is_active = 0 WHERE translation_block_id = ?1 AND is_active = 1",
        [block_id],
    )
    .map_err(sql_error)?;
    conn.execute(
        "INSERT INTO translation_versions (translation_block_id, translated_text, translator, is_active)
         VALUES (?1, ?2, ?3, 1)",
        params![block_id, translated_text, translator],
    )
    .map_err(sql_error)?;
    conn.execute(
        "UPDATE translation_blocks SET translated_text = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![translated_text, block_id],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn translator_name(value: &str) -> Result<String, String> {
    let value = required_text(value, "Переводчик")?;
    if value.chars().count() > 80 {
        return Err("Название переводчика слишком длинное".to_string());
    }
    Ok(value)
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn block_text(value: &str, label: &str) -> Result<String, String> {
    let value = required_text(value, label)?;
    if value.chars().count() > 20_000 {
        return Err(format!("{label} слишком длинный"));
    }
    Ok(value)
}

fn translation_block_by_id(conn: &Connection, id: i64) -> Result<TranslationBlock, String> {
    conn.query_row(
        &format!("SELECT {BLOCK_COLUMNS} FROM translation_blocks WHERE id = ?1"),
        [id],
        map_translation_block,
    )
    .optional()
    .map_err(sql_error)?
    .ok_or_else(|| "Перевод не найден".to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationVersion {
    pub id: i64,
    pub translation_block_id: i64,
    pub translated_text: String,
    pub translator: String,
    pub created_at: String,
    pub is_active: bool,
}

fn translation_version_by_id(conn: &Connection, id: i64) -> Result<TranslationVersion, String> {
    conn.query_row(
        "SELECT id, translation_block_id, translated_text, translator, created_at, is_active
         FROM translation_versions WHERE id = ?1",
        [id],
        map_translation_version,
    )
    .optional()
    .map_err(sql_error)?
    .ok_or_else(|| "Версия перевода не найдена".to_string())
}

fn map_translation_version(row: &rusqlite::Row) -> rusqlite::Result<TranslationVersion> {
    let active: i64 = row.get(5)?;
    Ok(TranslationVersion {
        id: row.get(0)?,
        translation_block_id: row.get(1)?,
        translated_text: row.get(2)?,
        translator: row.get(3)?,
        created_at: row.get(4)?,
        is_active: active != 0,
    })
}

fn map_translation_block(row: &rusqlite::Row) -> rusqlite::Result<TranslationBlock> {
    Ok(TranslationBlock {
        id: row.get(0)?,
        document_id: row.get(1)?,
        page_number: row.get(2)?,
        source_x: row.get(3)?,
        source_y: row.get(4)?,
        source_width: row.get(5)?,
        source_height: row.get(6)?,
        ocr_text: row.get(7)?,
        translated_text: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        popup_x: row.get(11)?,
        popup_y: row.get(12)?,
        popup_width: row.get(13)?,
        popup_height: row.get(14)?,
    })
}

fn ensure_active_document(conn: &Connection, id: i64) -> Result<(), String> {
    let document = get_document(conn, id)?;
    if document.deleted_at.is_some() {
        return Err("Документ находится в корзине".to_string());
    }
    Ok(())
}

fn page_number_value(page_number: i64) -> Result<i64, String> {
    if page_number < 1 {
        return Err("Некорректный номер страницы".to_string());
    }
    Ok(page_number)
}

fn optional_page(page_number: Option<i64>) -> Result<Option<i64>, String> {
    match page_number {
        Some(page) => Ok(Some(page_number_value(page)?)),
        None => Ok(None),
    }
}

fn short_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.chars().count() > 2_000 {
        return Err("Название закладки слишком длинное".to_string());
    }
    Ok(label.to_string())
}

fn dictionary_for(conn: &Connection, scope: &str, document_id: Option<i64>) -> Result<i64, String> {
    match scope {
        "global" => conn
            .query_row(
                "SELECT id FROM dictionaries WHERE kind = 'global'",
                [],
                |row| row.get(0),
            )
            .map_err(sql_error),
        "document" => {
            let document_id = document_id.ok_or_else(|| "Не указан документ".to_string())?;
            ensure_active_document(conn, document_id)?;
            conn.execute(
                "INSERT INTO dictionaries (kind, document_id)
                 SELECT 'document', ?1
                 WHERE NOT EXISTS (
                     SELECT 1 FROM dictionaries WHERE document_id = ?1
                 )",
                [document_id],
            )
            .map_err(sql_error)?;
            conn.query_row(
                "SELECT id FROM dictionaries WHERE document_id = ?1",
                [document_id],
                |row| row.get(0),
            )
            .map_err(sql_error)
        }
        _ => Err("Неизвестный словарь".to_string()),
    }
}

fn dictionary_rows(conn: &Connection, dictionary_id: i64) -> Result<Vec<DictionaryEntry>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, dictionary_id, source_text, translated_text, note, created_at, updated_at
             FROM dictionary_entries WHERE dictionary_id = ?1",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([dictionary_id], map_dictionary_entry)
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

fn dictionary_entry_by_id(conn: &Connection, id: i64) -> Result<DictionaryEntry, String> {
    conn.query_row(
        "SELECT id, dictionary_id, source_text, translated_text, note, created_at, updated_at
         FROM dictionary_entries WHERE id = ?1",
        [id],
        map_dictionary_entry,
    )
    .optional()
    .map_err(sql_error)?
    .ok_or_else(|| "Запись словаря не найдена".to_string())
}

fn ensure_entry_writable(conn: &Connection, id: i64) -> Result<(), String> {
    let entry = dictionary_entry_by_id(conn, id)?;
    let document_id: Option<i64> = conn
        .query_row(
            "SELECT document_id FROM dictionaries WHERE id = ?1",
            [entry.dictionary_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| "Словарь не найден".to_string())?;
    if let Some(document_id) = document_id {
        ensure_active_document(conn, document_id)?;
    }
    Ok(())
}

fn map_dictionary_entry(row: &rusqlite::Row) -> rusqlite::Result<DictionaryEntry> {
    Ok(DictionaryEntry {
        id: row.get(0)?,
        dictionary_id: row.get(1)?,
        source_text: row.get(2)?,
        translated_text: row.get(3)?,
        note: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn starts_with_word(text: &str, query: &str) -> bool {
    text.split(|ch: char| !ch.is_alphanumeric())
        .any(|word| !word.is_empty() && word.starts_with(query))
}

fn dictionary_phrase(value: &str, label: &str) -> Result<String, String> {
    let value = required_text(value, label)?;
    if value.chars().count() > 20_000 {
        return Err(format!("{label} слишком длинный"));
    }
    Ok(value)
}

fn dictionary_note(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.chars().count() > 4_000 {
        return Err("Комментарий слишком длинный".to_string());
    }
    Ok(value.to_string())
}

fn note_body(body: &str) -> Result<String, String> {
    let body = required_text(body, "Текст")?;
    if body.chars().count() > 20_000 {
        return Err("Заметка слишком длинная".to_string());
    }
    Ok(body)
}

fn bookmark_by_id(conn: &Connection, id: i64) -> Result<Bookmark, String> {
    conn.query_row(
        "SELECT id, document_id, page_number, label, created_at FROM bookmarks WHERE id = ?1",
        [id],
        map_bookmark,
    )
    .optional()
    .map_err(sql_error)?
    .ok_or_else(|| "Закладка не найдена".to_string())
}

fn note_by_id(conn: &Connection, id: i64) -> Result<Note, String> {
    conn.query_row(
        "SELECT id, document_id, page_number, body, created_at, updated_at FROM notes WHERE id = ?1",
        [id],
        map_note,
    )
    .optional()
    .map_err(sql_error)?
    .ok_or_else(|| "Заметка не найдена".to_string())
}

fn map_bookmark(row: &rusqlite::Row) -> rusqlite::Result<Bookmark> {
    Ok(Bookmark {
        id: row.get(0)?,
        document_id: row.get(1)?,
        page_number: row.get(2)?,
        label: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn map_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        document_id: row.get(1)?,
        page_number: row.get(2)?,
        body: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn normalize_zoom(zoom: &str) -> Result<String, String> {
    let zoom = zoom.trim();
    if zoom == "fit-width" || zoom == "fit-page" {
        return Ok(zoom.to_string());
    }
    let value: f64 = zoom
        .parse()
        .map_err(|_| "Некорректный масштаб".to_string())?;
    if !value.is_finite() || !(0.25..=4.0).contains(&value) {
        return Err("Некорректный масштаб".to_string());
    }
    Ok(format!("{value:.3}"))
}

pub fn delete_document(conn: &Connection, id: i64) -> Result<(), String> {
    let deleted = conn
        .execute("DELETE FROM documents WHERE id = ?1", [id])
        .map_err(sql_error)?;
    if deleted == 0 {
        return Err("Документ не найден".to_string());
    }
    Ok(())
}

pub fn list_shelves(conn: &Connection) -> Result<Vec<Shelf>, String> {
    list_named(
        conn,
        "SELECT id, name, created_at FROM shelves ORDER BY name COLLATE NOCASE, id",
    )
}

pub fn create_shelf(conn: &Connection, name: &str) -> Result<Shelf, String> {
    create_named(
        conn,
        NamedTable::Shelves,
        name,
        "Полка с таким названием уже есть",
    )
}

pub fn update_shelf(conn: &Connection, id: i64, name: &str) -> Result<Shelf, String> {
    update_named(
        conn,
        NamedTable::Shelves,
        id,
        name,
        "Полка не найдена",
        "Полка с таким названием уже есть",
    )
}

pub fn delete_shelf(conn: &Connection, id: i64) -> Result<(), String> {
    delete_named(
        conn,
        "DELETE FROM shelves WHERE id = ?1",
        id,
        "Полка не найдена",
    )
}

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>, String> {
    list_named(
        conn,
        "SELECT id, name, created_at FROM tags ORDER BY name COLLATE NOCASE, id",
    )
}

pub fn create_tag(conn: &Connection, name: &str) -> Result<Tag, String> {
    create_named(
        conn,
        NamedTable::Tags,
        name,
        "Тег с таким названием уже есть",
    )
}

pub fn update_tag(conn: &Connection, id: i64, name: &str) -> Result<Tag, String> {
    update_named(
        conn,
        NamedTable::Tags,
        id,
        name,
        "Тег не найден",
        "Тег с таким названием уже есть",
    )
}

pub fn delete_tag(conn: &Connection, id: i64) -> Result<(), String> {
    delete_named(conn, "DELETE FROM tags WHERE id = ?1", id, "Тег не найден")
}

pub fn reset_shelves(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM shelves", []).map_err(sql_error)?;
    Ok(())
}

pub fn reset_tags(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM tags", []).map_err(sql_error)?;
    Ok(())
}

pub fn clear_library(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM documents WHERE deleted_at IS NULL", [])
        .map_err(sql_error)?;
    Ok(())
}

pub fn copy_database(conn: &Connection, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Err("В выбранном месте уже есть файл".to_string());
    }
    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Не удалось создать каталог базы: {err}"))?;
        }
    }
    let dest = destination.to_string_lossy().to_string();
    if let Err(err) = conn.execute("VACUUM INTO ?1", [dest]) {
        if destination.exists() {
            let _ = std::fs::remove_file(destination);
        }
        return Err(format!("Не удалось скопировать базу: {err}"));
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum NamedTable {
    Shelves,
    Tags,
}

impl NamedTable {
    fn insert_sql(self) -> &'static str {
        match self {
            Self::Shelves => "INSERT INTO shelves (name, name_key) VALUES (?1, ?2)",
            Self::Tags => "INSERT INTO tags (name, name_key) VALUES (?1, ?2)",
        }
    }

    fn update_sql(self) -> &'static str {
        match self {
            Self::Shelves => "UPDATE shelves SET name = ?1, name_key = ?2 WHERE id = ?3",
            Self::Tags => "UPDATE tags SET name = ?1, name_key = ?2 WHERE id = ?3",
        }
    }

    fn exists_sql(self) -> &'static str {
        match self {
            Self::Shelves => "SELECT COUNT(*) FROM shelves WHERE name_key = ?1 AND id != ?2",
            Self::Tags => "SELECT COUNT(*) FROM tags WHERE name_key = ?1 AND id != ?2",
        }
    }

    fn select_sql(self) -> &'static str {
        match self {
            Self::Shelves => "SELECT id, name, created_at FROM shelves WHERE id = ?1",
            Self::Tags => "SELECT id, name, created_at FROM tags WHERE id = ?1",
        }
    }
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(sql_error)?;
    for (version, sql) in [
        (1, include_str!("../migrations/001_library.sql")),
        (2, include_str!("../migrations/002_name_key.sql")),
        (3, include_str!("../migrations/003_pdf_import.sql")),
        (4, include_str!("../migrations/004_trash.sql")),
        (5, include_str!("../migrations/005_reading_state.sql")),
        (6, include_str!("../migrations/006_bookmarks_notes.sql")),
        (7, include_str!("../migrations/007_translation_blocks.sql")),
        (8, include_str!("../migrations/008_translation_popups.sql")),
        (
            9,
            include_str!("../migrations/009_translation_versions.sql"),
        ),
        (10, include_str!("../migrations/010_dictionaries.sql")),
    ] {
        apply_migration(conn, version, sql)?;
    }
    Ok(())
}

fn apply_migration(conn: &Connection, version: i64, sql: &str) -> Result<(), String> {
    let applied: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            [version],
            |row| row.get(0),
        )
        .map_err(sql_error)?;
    if applied > 0 {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(sql_error)?;
    tx.execute_batch(sql).map_err(sql_error)?;
    if version == 2 {
        fill_name_keys(&tx)?;
        tx.execute_batch(
            "CREATE UNIQUE INDEX shelves_name_key ON shelves (name_key);
             CREATE UNIQUE INDEX tags_name_key ON tags (name_key);",
        )
        .map_err(sql_error)?;
    }
    tx.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
        [version],
    )
    .map_err(sql_error)?;
    tx.commit().map_err(sql_error)?;
    Ok(())
}

fn fill_name_keys(conn: &Connection) -> Result<(), String> {
    for table in ["shelves", "tags"] {
        let sql = match table {
            "shelves" => "SELECT id, name FROM shelves",
            "tags" => "SELECT id, name FROM tags",
            _ => unreachable!(),
        };
        let update_sql = match table {
            "shelves" => "UPDATE shelves SET name_key = ?1 WHERE id = ?2",
            "tags" => "UPDATE tags SET name_key = ?1 WHERE id = ?2",
            _ => unreachable!(),
        };
        let rows = conn
            .prepare(sql)
            .map_err(sql_error)?
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        for (id, name) in rows {
            conn.execute(update_sql, params![name_key(&name), id])
                .map_err(sql_error)?;
        }
    }
    Ok(())
}

fn create_named<T>(
    conn: &Connection,
    table: NamedTable,
    name: &str,
    duplicate_message: &str,
) -> Result<T, String>
where
    T: FromNamed,
{
    let name = limited_name(name)?;
    let key = name_key(&name);
    ensure_unique_name(conn, table, &key, -1, duplicate_message)?;
    conn.execute(table.insert_sql(), params![name, key])
        .map_err(sql_error)?;
    get_named(conn, table, conn.last_insert_rowid(), "Запись не найдена")
}

fn update_named<T>(
    conn: &Connection,
    table: NamedTable,
    id: i64,
    name: &str,
    missing_message: &str,
    duplicate_message: &str,
) -> Result<T, String>
where
    T: FromNamed,
{
    let name = limited_name(name)?;
    let key = name_key(&name);
    ensure_unique_name(conn, table, &key, id, duplicate_message)?;
    let updated = conn
        .execute(table.update_sql(), params![name, key, id])
        .map_err(sql_error)?;
    if updated == 0 {
        return Err(missing_message.to_string());
    }
    get_named(conn, table, id, missing_message)
}

fn delete_named(
    conn: &Connection,
    sql: &str,
    id: i64,
    missing_message: &str,
) -> Result<(), String> {
    let deleted = conn.execute(sql, [id]).map_err(sql_error)?;
    if deleted == 0 {
        return Err(missing_message.to_string());
    }
    Ok(())
}

fn list_named<T>(conn: &Connection, sql: &str) -> Result<Vec<T>, String>
where
    T: FromNamed,
{
    let mut statement = conn.prepare(sql).map_err(sql_error)?;
    let rows = statement.query_map([], map_named).map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

fn get_named<T>(
    conn: &Connection,
    table: NamedTable,
    id: i64,
    missing_message: &str,
) -> Result<T, String>
where
    T: FromNamed,
{
    conn.query_row(table.select_sql(), [id], map_named)
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| missing_message.to_string())
}

trait FromNamed: Sized {
    fn from_named(row: NamedRow) -> Self;
}

struct NamedRow {
    id: i64,
    name: String,
    created_at: String,
}

impl FromNamed for Shelf {
    fn from_named(row: NamedRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        }
    }
}

impl FromNamed for Tag {
    fn from_named(row: NamedRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        }
    }
}

fn map_named<T: FromNamed>(row: &rusqlite::Row) -> rusqlite::Result<T> {
    Ok(T::from_named(NamedRow {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
    }))
}

pub(crate) fn get_document(conn: &Connection, id: i64) -> Result<Document, String> {
    let sql = format!("{DOCUMENT_SELECT} WHERE d.id = ?1");
    conn.query_row(&sql, [id], map_document)
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| "Документ не найден".to_string())
}

fn map_document(row: &rusqlite::Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        original_filename: row.get(4)?,
        internal_filename: row.get(5)?,
        path: row.get(6)?,
        file_size: row.get(7)?,
        hash: row.get(8)?,
        shelf_ids: parse_ids(row.get(9)?),
        tag_ids: parse_ids(row.get(10)?),
        deleted_at: row.get(11)?,
        last_page: row.get(12)?,
        last_zoom: row.get(13)?,
    })
}

fn insert_links(
    conn: &Connection,
    document_id: i64,
    shelf_ids: &[i64],
    tag_ids: &[i64],
) -> Result<(), String> {
    for shelf_id in shelf_ids {
        conn.execute(
            "INSERT INTO document_shelves (document_id, shelf_id) VALUES (?1, ?2)",
            params![document_id, shelf_id],
        )
        .map_err(sql_error)?;
    }
    for tag_id in tag_ids {
        conn.execute(
            "INSERT INTO document_tags (document_id, tag_id) VALUES (?1, ?2)",
            params![document_id, tag_id],
        )
        .map_err(sql_error)?;
    }
    Ok(())
}

fn ensure_ids(
    conn: &Connection,
    table: &str,
    ids: &[i64],
    label: &str,
    missing: &str,
) -> Result<(), String> {
    let sql = match table {
        "shelves" => "SELECT COUNT(*) FROM shelves WHERE id = ?1",
        "tags" => "SELECT COUNT(*) FROM tags WHERE id = ?1",
        _ => return Err("Неизвестная таблица".to_string()),
    };
    for id in ids {
        let count: i64 = conn
            .query_row(sql, [id], |row| row.get(0))
            .map_err(sql_error)?;
        if count == 0 {
            return Err(format!("{label} {id} {missing}"));
        }
    }
    Ok(())
}

fn ensure_unique_name(
    conn: &Connection,
    table: NamedTable,
    name: &str,
    except_id: i64,
    message: &str,
) -> Result<(), String> {
    let count: i64 = conn
        .query_row(table.exists_sql(), params![name, except_id], |row| {
            row.get(0)
        })
        .map_err(sql_error)?;
    if count > 0 {
        return Err(message.to_string());
    }
    Ok(())
}

fn name_key(name: &str) -> String {
    name.to_lowercase()
}

const NAMED_LIMIT: usize = 30;

fn limited_name(value: &str) -> Result<String, String> {
    let value = required_text(value, "Название")?;
    if value.chars().count() > NAMED_LIMIT {
        return Err("Название не длиннее 30 символов".to_string());
    }
    Ok(value)
}

fn required_text(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} не может быть пустым"));
    }
    Ok(value.to_string())
}

fn unique_ids(ids: &[i64]) -> Vec<i64> {
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(id) {
            unique.push(*id);
        }
    }
    unique
}

fn parse_ids(value: Option<String>) -> Vec<i64> {
    let Some(value) = value.filter(|text| !text.is_empty()) else {
        return Vec::new();
    };
    let mut ids = value
        .split(',')
        .filter_map(|part| part.parse::<i64>().ok())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids
}

fn sql_error(err: rusqlite::Error) -> String {
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_DB: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn portable_paths_follow_the_moved_library_and_keep_trash_separate() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let book = insert_imported_document(
            &conn,
            "Book",
            "book.pdf",
            "100.pdf",
            Path::new("old/100.pdf"),
            10,
            "hash",
        )
        .unwrap();
        conn.execute(
            "UPDATE documents SET deleted_at = 'now' WHERE id = ?1",
            [book.id],
        )
        .unwrap();
        let active = insert_imported_document(
            &conn,
            "Active",
            "active.pdf",
            "101.pdf",
            Path::new("old/101.pdf"),
            10,
            "hash2",
        )
        .unwrap();
        rebase_portable_paths(&conn, Path::new("new/documents"), Path::new("new/trash")).unwrap();
        assert_eq!(
            get_document(&conn, book.id).unwrap().path,
            Some(Path::new("new/trash").join("100.pdf").display().to_string())
        );
        assert_eq!(
            get_document(&conn, active.id).unwrap().path,
            Some(Path::new("new/documents").join("101.pdf").display().to_string())
        );
    }

    fn temp_db() -> (std::path::PathBuf, Connection) {
        let n = NEXT_DB.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("llr-{nanos}-{n}.db"));
        let conn = open(&path).unwrap();
        (path, conn)
    }

    fn close(path: std::path::PathBuf, conn: Connection) {
        drop(conn);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn migration_runs_once() {
        let (path, conn) = temp_db();
        open(&path).unwrap();
        let version: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 10);
        close(path, conn);
    }

    #[test]
    fn shelf_and_tag_crud() {
        let (path, conn) = temp_db();
        let shelf = create_shelf(&conn, "  История ").unwrap();
        assert_eq!(shelf.name, "История");
        assert!(
            create_shelf(&conn, "история")
                .unwrap_err()
                .contains("уже есть")
        );
        assert!(create_shelf(&conn, "   ").is_err());
        let renamed = update_shelf(&conn, shelf.id, "Наука").unwrap();
        assert_eq!(renamed.name, "Наука");
        assert!(
            update_shelf(&conn, 99, "Другое")
                .unwrap_err()
                .contains("не найдена")
        );
        let long = create_shelf(&conn, &"я".repeat(30)).unwrap();
        assert_eq!(long.name.chars().count(), 30);
        assert!(
            create_shelf(&conn, &"я".repeat(31))
                .unwrap_err()
                .contains("30")
        );
        assert!(
            update_shelf(&conn, shelf.id, &"н".repeat(31))
                .unwrap_err()
                .contains("30")
        );
        delete_shelf(&conn, long.id).unwrap();
        delete_shelf(&conn, shelf.id).unwrap();
        assert!(list_shelves(&conn).unwrap().is_empty());

        assert!(
            create_tag(&conn, &"т".repeat(31))
                .unwrap_err()
                .contains("30")
        );
        let tag = create_tag(&conn, "важное").unwrap();
        assert_eq!(list_tags(&conn).unwrap().len(), 1);
        delete_tag(&conn, tag.id).unwrap();
        assert!(delete_tag(&conn, tag.id).unwrap_err().contains("не найден"));
        close(path, conn);
    }

    #[test]
    fn reset_shelves_keeps_tags_and_books() {
        let (path, conn) = temp_db();
        let shelf = create_shelf(&conn, "Полка").unwrap();
        let tag = create_tag(&conn, "Тег").unwrap();
        let document = create_document(&conn, "Книга", &[shelf.id], &[tag.id]).unwrap();
        reset_shelves(&conn).unwrap();
        assert!(list_shelves(&conn).unwrap().is_empty());
        assert_eq!(list_tags(&conn).unwrap().len(), 1);
        let kept = get_document(&conn, document.id).unwrap();
        assert!(kept.shelf_ids.is_empty());
        assert_eq!(kept.tag_ids, vec![tag.id]);
        close(path, conn);
    }

    #[test]
    fn reset_tags_keeps_shelves_and_books() {
        let (path, conn) = temp_db();
        let shelf = create_shelf(&conn, "Полка").unwrap();
        let tag = create_tag(&conn, "Тег").unwrap();
        let document = create_document(&conn, "Книга", &[shelf.id], &[tag.id]).unwrap();
        reset_tags(&conn).unwrap();
        assert!(list_tags(&conn).unwrap().is_empty());
        assert_eq!(list_shelves(&conn).unwrap().len(), 1);
        let kept = get_document(&conn, document.id).unwrap();
        assert_eq!(kept.shelf_ids, vec![shelf.id]);
        assert!(kept.tag_ids.is_empty());
        close(path, conn);
    }

    #[test]
    fn clear_library_removes_books_and_leaves_files() {
        let (path, conn) = temp_db();
        let document = create_document(&conn, "Книга", &[], &[]).unwrap();
        let trashed = create_document(&conn, "В корзине", &[], &[]).unwrap();
        mark_trashed(&conn, trashed.id, None, None).unwrap();
        let sibling = path.parent().unwrap().join(format!(
            "llr-book-{}.pdf",
            path.file_stem().unwrap().to_string_lossy()
        ));
        std::fs::write(&sibling, b"%PDF").unwrap();
        clear_library(&conn).unwrap();
        assert!(list_documents(&conn).unwrap().is_empty());
        assert!(get_document(&conn, document.id).is_err());
        assert_eq!(list_trash(&conn).unwrap().len(), 1);
        assert_eq!(std::fs::read(&sibling).unwrap(), b"%PDF");
        let _ = std::fs::remove_file(&sibling);
        close(path, conn);
    }

    #[test]
    fn copy_database_writes_a_second_file() {
        let (path, conn) = temp_db();
        create_document(&conn, "Книга", &[], &[]).unwrap();
        let destination = path.with_extension("copy.db");
        copy_database(&conn, &destination).unwrap();
        assert_eq!(list_documents(&conn).unwrap().len(), 1);
        let copied = open(&destination).unwrap();
        assert_eq!(list_documents(&copied).unwrap()[0].title, "Книга");
        close(destination, copied);
        close(path, conn);
    }

    #[test]
    fn document_links_follow_shelf_and_tag_lifetime() {
        let (path, conn) = temp_db();
        let shelf = create_shelf(&conn, "Полка").unwrap();
        let tag = create_tag(&conn, "Тег").unwrap();
        let err = create_document(&conn, "Черновик", &[99], &[]).unwrap_err();
        assert!(err.contains("не найдена"));
        assert!(list_documents(&conn).unwrap().is_empty());

        let document = create_document(&conn, "  Книга ", &[shelf.id], &[tag.id]).unwrap();
        assert_eq!(document.title, "Книга");
        assert_eq!(document.shelf_ids, vec![shelf.id]);
        assert_eq!(document.tag_ids, vec![tag.id]);

        let updated = update_document(&conn, document.id, "Архив", &[], &[tag.id]).unwrap();
        assert_eq!(updated.title, "Архив");
        assert!(updated.shelf_ids.is_empty());
        assert_eq!(updated.tag_ids, vec![tag.id]);

        delete_shelf(&conn, shelf.id).unwrap();
        delete_tag(&conn, tag.id).unwrap();
        let remaining = list_documents(&conn).unwrap();
        assert_eq!(remaining.len(), 1);
        assert!(remaining[0].shelf_ids.is_empty());
        assert!(remaining[0].tag_ids.is_empty());

        delete_document(&conn, document.id).unwrap();
        assert!(list_documents(&conn).unwrap().is_empty());
        assert!(
            delete_document(&conn, document.id)
                .unwrap_err()
                .contains("не найден")
        );
        close(path, conn);
    }

    #[test]
    fn reading_position_is_saved_for_the_document() {
        let (path, conn) = temp_db();
        let document = create_document(&conn, "Книга", &[], &[]).unwrap();
        assert_eq!(document.last_page, 1);
        assert_eq!(document.last_zoom, "fit-width");

        save_reading_state(&conn, document.id, 7, "1.5").unwrap();
        let stored = get_document(&conn, document.id).unwrap();
        assert_eq!(stored.last_page, 7);
        assert_eq!(stored.last_zoom, "1.500");

        assert!(save_reading_state(&conn, document.id, 0, "fit-page").is_err());
        assert!(
            save_reading_state(&conn, document.id, 2, "9")
                .unwrap_err()
                .contains("масштаб")
        );
        let unchanged = get_document(&conn, document.id).unwrap();
        assert_eq!(unchanged.last_page, 7);
        assert_eq!(unchanged.last_zoom, "1.500");
        close(path, conn);
    }

    #[test]
    fn bookmarks_and_notes_belong_to_one_document() {
        let (path, conn) = temp_db();
        let first = create_document(&conn, "Книга", &[], &[]).unwrap();
        let second = create_document(&conn, "Другая", &[], &[]).unwrap();

        let chapter = create_bookmark(&conn, first.id, 2, "  Глава ").unwrap();
        assert_eq!(chapter.label, "Глава");
        assert_eq!(chapter.page_number, 2);
        create_bookmark(&conn, first.id, 8, "").unwrap();
        assert!(create_bookmark(&conn, first.id, 0, "").is_err());
        assert_eq!(list_bookmarks(&conn, second.id).unwrap().len(), 0);
        let bookmarks = list_bookmarks(&conn, first.id).unwrap();
        assert_eq!(bookmarks.len(), 2);
        assert_eq!(bookmarks[0].page_number, 2);
        delete_bookmark(&conn, chapter.id).unwrap();
        assert_eq!(list_bookmarks(&conn, first.id).unwrap().len(), 1);

        let document_note = create_note(&conn, first.id, None, "  Общая ").unwrap();
        assert_eq!(document_note.page_number, None);
        assert_eq!(document_note.body, "Общая");
        let page_note = create_note(&conn, first.id, Some(8), "На странице").unwrap();
        assert_eq!(page_note.page_number, Some(8));
        assert!(create_note(&conn, first.id, Some(3), "   ").is_err());
        let edited = update_note(&conn, page_note.id, "Исправленная").unwrap();
        assert_eq!(edited.body, "Исправленная");
        assert_ne!(edited.updated_at, "");
        delete_note(&conn, document_note.id).unwrap();
        let notes = list_notes(&conn, first.id).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].page_number, Some(8));
        assert!(list_notes(&conn, second.id).unwrap().is_empty());

        delete_document(&conn, first.id).unwrap();
        let bookmarks_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0))
            .unwrap();
        let notes_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(bookmarks_left, 0);
        assert_eq!(notes_left, 0);
        close(path, conn);
    }

    #[test]
    fn translation_blocks_follow_the_page_and_the_document() {
        let (path, conn) = temp_db();
        let first = create_document(&conn, "Книга", &[], &[]).unwrap();
        let second = create_document(&conn, "Другая", &[], &[]).unwrap();

        let saved = create_translation_block(
            &conn,
            first.id,
            2,
            0.15,
            0.22,
            0.4,
            0.18,
            "  The fox  ",
            "  Лиса  ",
            "ctranslate2:en-ru",
        )
        .unwrap();
        assert_eq!(saved.page_number, 2);
        assert_eq!(saved.ocr_text, "The fox");
        assert_eq!(saved.translated_text, "Лиса");
        assert!((saved.source_x - 0.15).abs() < 0.0001);
        assert!((saved.source_width - 0.4).abs() < 0.0001);
        let other = create_translation_block(
            &conn,
            first.id,
            2,
            0.1,
            0.6,
            0.2,
            0.1,
            "Hello",
            "Привет",
            "manual",
        )
        .unwrap();
        assert!(
            create_translation_block(&conn, first.id, 0, 0.1, 0.1, 0.2, 0.2, "A", "Б", "manual")
                .is_err()
        );
        assert!(
            create_translation_block(&conn, first.id, 2, 0.1, 0.1, 0.0, 0.2, "A", "Б", "manual")
                .is_err()
        );
        assert!(
            create_translation_block(&conn, first.id, 2, -0.1, 0.1, 0.2, 0.2, "A", "Б", "manual")
                .is_err()
        );
        assert!(
            create_translation_block(&conn, first.id, 2, 0.9, 0.1, 0.2, 0.2, "A", "Б", "manual")
                .is_err()
        );
        assert!(
            create_translation_block(&conn, first.id, 2, 0.1, 0.1, 0.2, 0.2, "  ", "Б", "manual")
                .is_err()
        );
        assert!(list_translation_blocks(&conn, 99, 2).is_err());
        assert!(
            list_translation_blocks(&conn, second.id, 2)
                .unwrap()
                .is_empty()
        );
        assert!(
            list_translation_blocks(&conn, first.id, 3)
                .unwrap()
                .is_empty()
        );
        let page = list_translation_blocks(&conn, first.id, 2).unwrap();
        assert_eq!(page.len(), 2);

        let edited = update_translation_block(&conn, saved.id, "Fox", "Лиса стоит").unwrap();
        assert_eq!(edited.ocr_text, "Fox");
        assert_eq!(edited.translated_text, "Лиса стоит");
        assert!((edited.source_x - saved.source_x).abs() < 0.0001);
        assert!((edited.source_width - saved.source_width).abs() < 0.0001);
        assert_ne!(edited.updated_at, "");
        assert_eq!(saved.popup_x, None);
        assert_eq!(edited.popup_x, None);
        let versions = list_translation_versions(&conn, saved.id).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions.iter().filter(|item| item.is_active).count(), 1);
        assert_eq!(versions[0].translator, "manual");
        assert_eq!(versions[0].translated_text, "Лиса стоит");
        assert_eq!(versions[1].translated_text, "Лиса");
        assert!(!versions[1].is_active);
        update_translation_block(&conn, saved.id, "Fox", "Лиса стоит").unwrap();
        assert_eq!(list_translation_versions(&conn, saved.id).unwrap().len(), 2);
        assert!(add_translation_version(&conn, saved.id, " ", "ctranslate2:en-ru").is_err());
        assert_eq!(list_translation_versions(&conn, saved.id).unwrap().len(), 2);

        let placed = update_translation_popup(&conn, saved.id, 0.5, 0.2, 0.3, 0.16).unwrap();
        assert!((placed.popup_x.unwrap() - 0.5).abs() < 0.0001);
        assert!((placed.popup_y.unwrap() - 0.2).abs() < 0.0001);
        assert!((placed.popup_width.unwrap() - 0.3).abs() < 0.0001);
        assert!((placed.popup_height.unwrap() - 0.16).abs() < 0.0001);
        assert_eq!(placed.ocr_text, "Fox");
        let switched = activate_translation_version(&conn, versions[1].id).unwrap();
        assert_eq!(switched.translated_text, "Лиса");
        assert!((switched.popup_x.unwrap() - placed.popup_x.unwrap()).abs() < 0.0001);
        assert_eq!(
            list_translation_versions(&conn, saved.id)
                .unwrap()
                .iter()
                .filter(|item| item.is_active)
                .count(),
            1
        );
        activate_translation_version(&conn, versions[0].id).unwrap();
        let kept = update_translation_block(&conn, saved.id, "Fox", "Лиса стоит").unwrap();
        assert!((kept.popup_x.unwrap() - 0.5).abs() < 0.0001);
        assert!(update_translation_popup(&conn, saved.id, 0.1, 0.1, 0.0, 0.2).is_err());
        assert!(
            (update_translation_popup(&conn, saved.id, 1.4, -0.2, 0.2, 0.1)
                .unwrap()
                .popup_x
                .unwrap()
                - 0.8)
                .abs()
                < 0.0001
        );

        delete_translation_block(&conn, saved.id).unwrap();
        let remaining = list_translation_blocks(&conn, first.id, 2).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, other.id);
        assert!(
            delete_translation_block(&conn, saved.id)
                .unwrap_err()
                .contains("не найден")
        );

        delete_document(&conn, first.id).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM translation_blocks", [], |row| {
                row.get(0)
            })
            .unwrap();
        let versions_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM translation_versions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(left, 0);
        assert_eq!(versions_left, 0);
        close(path, conn);
    }

    #[test]
    fn clearing_a_book_removes_only_its_translations_or_notes() {
        let (path, conn) = temp_db();
        let first = create_document(&conn, "Книга", &[], &[]).unwrap();
        let second = create_document(&conn, "Другая", &[], &[]).unwrap();
        create_translation_block(
            &conn, first.id, 2, 0.1, 0.1, 0.2, 0.2, "Cat", "Кот", "manual",
        )
        .unwrap();
        create_translation_block(
            &conn, second.id, 1, 0.1, 0.1, 0.2, 0.2, "Dog", "Пёс", "manual",
        )
        .unwrap();
        create_note(&conn, first.id, None, "Общая").unwrap();
        create_note(&conn, first.id, Some(2), "На странице").unwrap();
        create_note(&conn, second.id, None, "Чужая").unwrap();
        create_bookmark(&conn, first.id, 2, "Глава").unwrap();

        delete_document_translations(&conn, first.id).unwrap();
        assert!(
            list_translation_blocks(&conn, first.id, 2)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_translation_blocks(&conn, second.id, 1).unwrap().len(),
            1
        );
        assert_eq!(list_notes(&conn, first.id).unwrap().len(), 2);
        assert_eq!(list_bookmarks(&conn, first.id).unwrap().len(), 1);
        let versions_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM translation_versions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(versions_left, 1);

        delete_document_notes(&conn, first.id).unwrap();
        assert!(list_notes(&conn, first.id).unwrap().is_empty());
        assert_eq!(list_notes(&conn, second.id).unwrap().len(), 1);
        assert_eq!(list_bookmarks(&conn, first.id).unwrap().len(), 1);

        delete_document_translations(&conn, first.id).unwrap();
        delete_document_notes(&conn, first.id).unwrap();
        assert!(
            delete_document_translations(&conn, 99)
                .unwrap_err()
                .contains("не найден")
        );
        assert!(
            delete_document_notes(&conn, 99)
                .unwrap_err()
                .contains("не найден")
        );
        mark_trashed(&conn, first.id, None, None).unwrap();
        assert!(
            delete_document_translations(&conn, first.id)
                .unwrap_err()
                .contains("корзине")
        );
        assert!(
            delete_document_notes(&conn, first.id)
                .unwrap_err()
                .contains("корзине")
        );
        close(path, conn);
    }

    #[test]
    fn migration_copies_an_existing_translation_into_a_version() {
        let (path, conn) = temp_db();
        let document = create_document(&conn, "Книга", &[], &[]).unwrap();
        conn.execute(
            "INSERT INTO translation_blocks (
                document_id, page_number, source_x, source_y, source_width, source_height,
                ocr_text, translated_text
             ) VALUES (?1, 1, 0.1, 0.2, 0.3, 0.1, 'Hello', 'Старый перевод')",
            [document.id],
        )
        .unwrap();
        let block_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO translation_versions (translation_block_id, translated_text, translator, created_at, is_active)
             SELECT id, translated_text, 'legacy', created_at, 1
             FROM translation_blocks
             WHERE trim(translated_text) <> ''
               AND NOT EXISTS (
                   SELECT 1 FROM translation_versions
                   WHERE translation_block_id = translation_blocks.id
               )",
            [],
        )
        .unwrap();
        let versions = list_translation_versions(&conn, block_id).unwrap();
        assert_eq!(versions.len(), 1);
        assert!(versions[0].is_active);
        assert_eq!(versions[0].translator, "legacy");
        assert_eq!(versions[0].translated_text, "Старый перевод");
        let shown = list_translation_blocks(&conn, document.id, 1).unwrap();
        assert_eq!(shown[0].translated_text, "Старый перевод");
        close(path, conn);
    }

    #[test]
    fn dictionaries_stay_with_their_owner() {
        let (path, conn) = temp_db();
        let first = create_document(&conn, "Первая", &[], &[]).unwrap();
        let second = create_document(&conn, "Вторая", &[], &[]).unwrap();
        let global =
            create_dictionary_entry(&conn, "global", None, " fox ", "лиса", "зверь").unwrap();
        let book =
            create_dictionary_entry(&conn, "document", Some(first.id), "Page", "Страница", "")
                .unwrap();
        create_dictionary_entry(&conn, "document", Some(second.id), "Note", "Заметка", "").unwrap();
        assert!(create_dictionary_entry(&conn, "document", Some(first.id), "  ", "А", "").is_err());
        assert!(create_dictionary_entry(&conn, "library", None, "A", "Б", "").is_err());
        let found = list_dictionary_entries(&conn, "global", None, "ЛИС").unwrap();
        assert!(
            list_dictionary_entries(&conn, "global", None, "ис")
                .unwrap()
                .is_empty()
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, global.id);
        assert_eq!(found[0].note, "зверь");
        assert!(
            list_dictionary_entries(&conn, "document", Some(first.id), "note")
                .unwrap()
                .is_empty()
        );
        let edited = update_dictionary_entry(&conn, book.id, "Page", "Лист", "номер").unwrap();
        assert_eq!(edited.translated_text, "Лист");
        assert_eq!(edited.note, "номер");
        delete_dictionary_entry(&conn, book.id).unwrap();
        assert!(
            list_dictionary_entries(&conn, "document", Some(first.id), "")
                .unwrap()
                .is_empty()
        );
        delete_document(&conn, first.id).unwrap();
        assert!(list_dictionary_entries(&conn, "document", Some(first.id), "").is_err());
        assert_eq!(
            list_dictionary_entries(&conn, "global", None, "")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            list_dictionary_entries(&conn, "document", Some(second.id), "")
                .unwrap()
                .len(),
            1
        );
        let dictionaries: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dictionaries WHERE document_id = ?1",
                [first.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(dictionaries, 0);
        close(path, conn);
    }
}

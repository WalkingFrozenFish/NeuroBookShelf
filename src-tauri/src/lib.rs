mod db;
mod import;
mod storage;
mod worker;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use db::{Bookmark, DictionaryEntry, Document, Note, Shelf, Tag, TranslationBlock, TranslationVersion};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const THEMES: &[&str] = &["light", "dark", "sage", "rose", "mist"];

struct AppDb {
    conn: Mutex<rusqlite::Connection>,
    path: Mutex<PathBuf>,
    settings_path: PathBuf,
    settings_lock: Mutex<()>,
    documents_dir: PathBuf,
    trash_dir: PathBuf,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    #[serde(default)]
    database_path: Option<String>,
    #[serde(default = "default_theme")]
    theme: String,
}

fn default_theme() -> String {
    "light".to_string()
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            database_path: None,
            theme: default_theme(),
        }
    }
}

fn with_conn<T>(
    db: State<AppDb>,
    action: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Не удалось обратиться к базе".to_string())?;
    action(&conn)
}

#[tauri::command]
fn database_path(db: State<AppDb>) -> String {
    db.path
        .lock()
        .map(|path| path.display().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn get_theme(db: State<AppDb>) -> String {
    valid_theme(&read_settings(&db.settings_path).theme)
}

#[tauri::command]
fn set_theme(db: State<AppDb>, theme: String) -> Result<(), String> {
    let theme = theme.trim();
    if !THEMES.contains(&theme) {
        return Err("Неизвестная тема".to_string());
    }
    update_settings(&db, |settings| settings.theme = theme.to_string())
}

#[tauri::command]
fn relocate_database(app: tauri::AppHandle, db: State<AppDb>) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("База SQLite", &["db"])
        .set_file_name("library.db")
        .set_title("Новое место базы")
        .blocking_save_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let destination = file
        .into_path()
        .map_err(|err| format!("Не удалось прочитать выбранный путь: {err}"))?;
    let current = db
        .path
        .lock()
        .map_err(|_| "Не удалось обратиться к базе".to_string())?
        .clone();
    if same_file(&current, &destination) {
        return Ok(None);
    }
    {
        let mut conn = db
            .conn
            .lock()
            .map_err(|_| "Не удалось обратиться к базе".to_string())?;
        db::copy_database(&conn, &destination)?;
        let opened = match db::open(&destination) {
            Ok(opened) => opened,
            Err(err) => {
                let _ = std::fs::remove_file(&destination);
                return Err(err);
            }
        };
        if let Err(err) = update_settings(&db, |settings| {
            settings.database_path = Some(destination.display().to_string());
        }) {
            drop(opened);
            let _ = std::fs::remove_file(&destination);
            return Err(err);
        }
        *conn = opened;
    }
    *db.path
        .lock()
        .map_err(|_| "Не удалось обратиться к базе".to_string())? = destination.clone();
    Ok(Some(destination.display().to_string()))
}

#[tauri::command]
fn reset_shelves(db: State<AppDb>) -> Result<(), String> {
    with_conn(db, db::reset_shelves)
}

#[tauri::command]
fn reset_tags(db: State<AppDb>) -> Result<(), String> {
    with_conn(db, db::reset_tags)
}

#[tauri::command]
fn clear_library(db: State<AppDb>) -> Result<(), String> {
    with_conn(db, db::clear_library)
}

#[tauri::command]
fn list_documents(db: State<AppDb>) -> Result<Vec<Document>, String> {
    with_conn(db, db::list_documents)
}

#[tauri::command]
fn create_document(
    db: State<AppDb>,
    title: String,
    shelf_ids: Vec<i64>,
    tag_ids: Vec<i64>,
) -> Result<Document, String> {
    with_conn(db, |conn| db::create_document(conn, &title, &shelf_ids, &tag_ids))
}

#[tauri::command]
fn update_document(
    db: State<AppDb>,
    id: i64,
    title: String,
    shelf_ids: Vec<i64>,
    tag_ids: Vec<i64>,
) -> Result<Document, String> {
    with_conn(db, |conn| {
        db::update_document(conn, id, &title, &shelf_ids, &tag_ids)
    })
}

#[tauri::command]
fn trash_document(db: State<AppDb>, id: i64) -> Result<(), String> {
    let documents_dir = db.documents_dir.clone();
    let trash_dir = db.trash_dir.clone();
    with_conn(db, |conn| {
        storage::trash_document(conn, id, &documents_dir, &trash_dir)
    })
}

#[tauri::command]
fn list_trash(db: State<AppDb>) -> Result<Vec<Document>, String> {
    with_conn(db, db::list_trash)
}

#[tauri::command]
fn restore_document(db: State<AppDb>, id: i64) -> Result<Document, String> {
    let documents_dir = db.documents_dir.clone();
    let trash_dir = db.trash_dir.clone();
    with_conn(db, |conn| {
        storage::restore_document(conn, id, &documents_dir, &trash_dir)
    })
}

#[tauri::command]
fn purge_document(db: State<AppDb>, id: i64) -> Result<(), String> {
    let trash_dir = db.trash_dir.clone();
    with_conn(db, |conn| storage::purge_document(conn, id, &trash_dir))
}

#[tauri::command]
fn get_document(db: State<AppDb>, id: i64) -> Result<Document, String> {
    with_conn(db, |conn| db::get_document(conn, id))
}

#[tauri::command]
fn read_document_pdf(db: State<AppDb>, id: i64) -> Result<tauri::ipc::Response, String> {
    let documents_dir = db.documents_dir.clone();
    let bytes = with_conn(db, |conn| {
        let document = db::get_document(conn, id)?;
        storage::read_library_pdf(&documents_dir, &document)
    })?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn save_reading_state(db: State<AppDb>, id: i64, page: i64, zoom: String) -> Result<(), String> {
    with_conn(db, |conn| db::save_reading_state(conn, id, page, &zoom))
}

#[tauri::command]
async fn ocr_document_region(
    db: State<'_, AppDb>,
    id: i64,
    page_number: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<worker::WorkerResponse, String> {
    let documents_dir = db.documents_dir.clone();
    let path = with_conn(db, |conn| {
        let document = db::get_document(conn, id)?;
        storage::library_pdf_path(&documents_dir, &document)
    })?;
    worker_call(
        "ocr_region",
        Some(serde_json::json!({
            "pdfPath": path.display().to_string(),
            "pageNumber": page_number,
            "rect": { "x": x, "y": y, "width": width, "height": height },
        })),
    )
    .await
}

#[tauri::command]
async fn ocr_document_page(
    db: State<'_, AppDb>,
    id: i64,
    page_number: i64,
) -> Result<worker::WorkerResponse, String> {
    let documents_dir = db.documents_dir.clone();
    let path = with_conn(db, |conn| {
        let document = db::get_document(conn, id)?;
        storage::library_pdf_path(&documents_dir, &document)
    })?;
    worker_call(
        "ocr_page",
        Some(serde_json::json!({
            "pdfPath": path.display().to_string(),
            "pageNumber": page_number,
        })),
    )
    .await
}

#[tauri::command]
async fn translate_text(
    text: String,
    source_language: String,
    target_language: String,
) -> Result<worker::WorkerResponse, String> {
    worker_call(
        "translate",
        Some(serde_json::json!({
            "text": text,
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
        })),
    )
    .await
}

#[tauri::command]
async fn analyze_document_page(
    db: State<'_, AppDb>,
    id: i64,
    page_number: i64,
) -> Result<worker::WorkerResponse, String> {
    let documents_dir = db.documents_dir.clone();
    let path = with_conn(db, |conn| {
        let document = db::get_document(conn, id)?;
        storage::library_pdf_path(&documents_dir, &document)
    })?;
    worker_call(
        "analyze_page",
        Some(serde_json::json!({
            "path": path.display().to_string(),
            "pageNumber": page_number,
        })),
    )
    .await
}

async fn worker_call(
    command: &'static str,
    payload: Option<serde_json::Value>,
) -> Result<worker::WorkerResponse, String> {
    tauri::async_runtime::spawn_blocking(move || worker::call_value(command, payload))
        .await
        .map_err(|_| "Фоновая задача была прервана".to_string())?
}

#[tauri::command]
fn list_bookmarks(db: State<AppDb>, document_id: i64) -> Result<Vec<Bookmark>, String> {
    with_conn(db, |conn| db::list_bookmarks(conn, document_id))
}

#[tauri::command]
fn create_bookmark(
    db: State<AppDb>,
    document_id: i64,
    page_number: i64,
    label: String,
) -> Result<Bookmark, String> {
    with_conn(db, |conn| {
        db::create_bookmark(conn, document_id, page_number, &label)
    })
}

#[tauri::command]
fn delete_bookmark(db: State<AppDb>, id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_bookmark(conn, id))
}

#[tauri::command]
fn list_notes(db: State<AppDb>, document_id: i64) -> Result<Vec<Note>, String> {
    with_conn(db, |conn| db::list_notes(conn, document_id))
}

#[tauri::command]
fn create_note(
    db: State<AppDb>,
    document_id: i64,
    page_number: Option<i64>,
    body: String,
) -> Result<Note, String> {
    with_conn(db, |conn| db::create_note(conn, document_id, page_number, &body))
}

#[tauri::command]
fn update_note(db: State<AppDb>, id: i64, body: String) -> Result<Note, String> {
    with_conn(db, |conn| db::update_note(conn, id, &body))
}

#[tauri::command]
fn delete_note(db: State<AppDb>, id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_note(conn, id))
}

#[tauri::command]
fn list_dictionary_entries(
    db: State<AppDb>,
    scope: String,
    document_id: Option<i64>,
    query: String,
) -> Result<Vec<DictionaryEntry>, String> {
    with_conn(db, |conn| db::list_dictionary_entries(conn, &scope, document_id, &query))
}

#[tauri::command]
fn create_dictionary_entry(
    db: State<AppDb>,
    scope: String,
    document_id: Option<i64>,
    source_text: String,
    translated_text: String,
    note: String,
) -> Result<DictionaryEntry, String> {
    with_conn(db, |conn| {
        db::create_dictionary_entry(conn, &scope, document_id, &source_text, &translated_text, &note)
    })
}

#[tauri::command]
fn update_dictionary_entry(
    db: State<AppDb>,
    id: i64,
    source_text: String,
    translated_text: String,
    note: String,
) -> Result<DictionaryEntry, String> {
    with_conn(db, |conn| db::update_dictionary_entry(conn, id, &source_text, &translated_text, &note))
}

#[tauri::command]
fn delete_dictionary_entry(db: State<AppDb>, id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_dictionary_entry(conn, id))
}

#[tauri::command]
fn list_translation_blocks(
    db: State<AppDb>,
    document_id: i64,
    page_number: i64,
) -> Result<Vec<TranslationBlock>, String> {
    with_conn(db, |conn| {
        db::list_translation_blocks(conn, document_id, page_number)
    })
}

#[tauri::command]
fn create_translation_block(
    db: State<AppDb>,
    document_id: i64,
    page_number: i64,
    source_x: f64,
    source_y: f64,
    source_width: f64,
    source_height: f64,
    ocr_text: String,
    translated_text: String,
    translator: String,
) -> Result<TranslationBlock, String> {
    with_conn(db, |conn| {
        db::create_translation_block(
            conn,
            document_id,
            page_number,
            source_x,
            source_y,
            source_width,
            source_height,
            &ocr_text,
            &translated_text,
            &translator,
        )
    })
}

#[tauri::command]
fn update_translation_block(
    db: State<AppDb>,
    id: i64,
    ocr_text: String,
    translated_text: String,
) -> Result<TranslationBlock, String> {
    with_conn(db, |conn| db::update_translation_block(conn, id, &ocr_text, &translated_text))
}

#[tauri::command]
fn delete_translation_block(db: State<AppDb>, id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_translation_block(conn, id))
}

#[tauri::command]
fn list_translation_versions(
    db: State<AppDb>,
    block_id: i64,
) -> Result<Vec<TranslationVersion>, String> {
    with_conn(db, |conn| db::list_translation_versions(conn, block_id))
}

#[tauri::command]
fn activate_translation_version(db: State<AppDb>, version_id: i64) -> Result<TranslationBlock, String> {
    with_conn(db, |conn| db::activate_translation_version(conn, version_id))
}

#[tauri::command]
async fn retranslate_translation_block(db: State<'_, AppDb>, id: i64) -> Result<TranslationBlock, String> {
    let ocr_text = with_conn(db.clone(), |conn| db::translation_block_ocr(conn, id))?;
    let response = worker_call(
        "translate",
        Some(serde_json::json!({
            "text": ocr_text,
            "sourceLanguage": "en",
            "targetLanguage": "ru",
        })),
    )
    .await?;
    if !response.success {
        let code = response
            .error
            .as_ref()
            .map(|item| item.code.as_str())
            .unwrap_or("TRANSLATION_ERROR");
        let message = response
            .error
            .as_ref()
            .map(|item| item.message.as_str())
            .unwrap_or("Не удалось перевести текст");
        return Err(format!("{code}: {message}"));
    }
    let result = response
        .result
        .as_ref()
        .ok_or_else(|| "EMPTY_TEXT: Перевод пустой".to_string())?;
    let translated = result
        .get("translatedText")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if translated.is_empty() {
        return Err("EMPTY_TEXT: Перевод пустой".to_string());
    }
    let translator = result
        .get("translator")
        .and_then(|value| value.as_str())
        .unwrap_or("ctranslate2:en-ru");
    with_conn(db, |conn| db::add_translation_version(conn, id, translated, translator))
}

#[tauri::command]
fn update_translation_popup(
    db: State<AppDb>,
    id: i64,
    popup_x: f64,
    popup_y: f64,
    popup_width: f64,
    popup_height: f64,
) -> Result<TranslationBlock, String> {
    with_conn(db, |conn| {
        db::update_translation_popup(conn, id, popup_x, popup_y, popup_width, popup_height)
    })
}

#[tauri::command]
fn export_pdf(app: tauri::AppHandle, db: State<AppDb>, id: i64) -> Result<Option<String>, String> {
    let export = {
        let conn = db
            .conn
            .lock()
            .map_err(|_| "Не удалось обратиться к базе".to_string())?;
        let document = db::get_document(&conn, id)?;
        if document.deleted_at.is_some() {
            return Err("Сначала восстановите документ из корзины".to_string());
        }
        let path = document
            .path
            .ok_or_else(|| "У документа нет PDF".to_string())?;
        let file_name = document
            .original_filename
            .or(document.internal_filename)
            .ok_or_else(|| "У документа нет PDF".to_string())?;
        (path, file_name)
    };
    let picked = app
        .dialog()
        .file()
        .set_title("Экспорт PDF")
        .blocking_pick_folder();
    let Some(folder) = picked else {
        return Ok(None);
    };
    let folder = folder
        .into_path()
        .map_err(|err| format!("Не удалось прочитать выбранную папку: {err}"))?;
    let destination = storage::export_pdf(
        &db.documents_dir,
        PathBuf::from(&export.0).as_path(),
        &folder,
        &export.1,
    )?;
    Ok(Some(destination.display().to_string()))
}

#[tauri::command]
fn import_pdf(app: tauri::AppHandle, db: State<AppDb>) -> Result<Option<Document>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_title("Импорт PDF")
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let source = file
        .into_path()
        .map_err(|err| format!("Не удалось прочитать выбранный файл: {err}"))?;
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Не удалось обратиться к базе".to_string())?;
    import::import_pdf(&source, &db.documents_dir, &conn).map(Some)
}

#[tauri::command]
fn list_shelves(db: State<AppDb>) -> Result<Vec<Shelf>, String> {
    with_conn(db, db::list_shelves)
}

#[tauri::command]
fn create_shelf(db: State<AppDb>, name: String) -> Result<Shelf, String> {
    with_conn(db, |conn| db::create_shelf(conn, &name))
}

#[tauri::command]
fn update_shelf(db: State<AppDb>, id: i64, name: String) -> Result<Shelf, String> {
    with_conn(db, |conn| db::update_shelf(conn, id, &name))
}

#[tauri::command]
fn delete_shelf(db: State<AppDb>, id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_shelf(conn, id))
}

#[tauri::command]
fn list_tags(db: State<AppDb>) -> Result<Vec<Tag>, String> {
    with_conn(db, db::list_tags)
}

#[tauri::command]
fn create_tag(db: State<AppDb>, name: String) -> Result<Tag, String> {
    with_conn(db, |conn| db::create_tag(conn, &name))
}

#[tauri::command]
fn update_tag(db: State<AppDb>, id: i64, name: String) -> Result<Tag, String> {
    with_conn(db, |conn| db::update_tag(conn, id, &name))
}

#[tauri::command]
fn delete_tag(db: State<AppDb>, id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_tag(conn, id))
}

fn open_database(app: &tauri::App) -> Result<AppDb, Box<dyn std::error::Error>> {
    let root = app.path().app_data_dir()?;
    let data_dir = root.join("data");
    let documents_dir = root.join("library").join("documents");
    let trash_dir = root.join("library").join("trash");
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&documents_dir)?;
    std::fs::create_dir_all(&trash_dir)?;
    let settings_path = root.join("settings.json");
    let mut settings = read_settings(&settings_path);
    let path = match settings.database_path.as_deref().map(PathBuf::from) {
        Some(candidate) if candidate.is_file() => candidate,
        Some(_) => {
            settings.database_path = None;
            let _ = write_settings(&settings_path, &settings);
            data_dir.join("library.db")
        }
        None => data_dir.join("library.db"),
    };
    let conn = db::open(&path)?;
    Ok(AppDb {
        conn: Mutex::new(conn),
        path: Mutex::new(path),
        settings_path,
        settings_lock: Mutex::new(()),
        documents_dir,
        trash_dir,
    })
}

fn read_settings(path: &Path) -> StoredSettings {
    let Ok(text) = std::fs::read_to_string(path) else {
        return StoredSettings::default();
    };
    let mut settings: StoredSettings = serde_json::from_str(&text).unwrap_or_default();
    settings.theme = valid_theme(&settings.theme);
    settings
}

fn write_settings(path: &Path, settings: &StoredSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Не удалось сохранить настройки: {err}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|err| format!("Не удалось сохранить настройки: {err}"))?;
    std::fs::write(path, text).map_err(|err| format!("Не удалось сохранить настройки: {err}"))
}

fn update_settings(db: &AppDb, change: impl FnOnce(&mut StoredSettings)) -> Result<(), String> {
    let _guard = db
        .settings_lock
        .lock()
        .map_err(|_| "Не удалось сохранить настройки".to_string())?;
    let mut settings = read_settings(&db.settings_path);
    change(&mut settings);
    settings.theme = valid_theme(&settings.theme);
    write_settings(&db.settings_path, &settings)
}

fn valid_theme(theme: &str) -> String {
    if THEMES.contains(&theme) {
        theme.to_string()
    } else {
        default_theme()
    }
}

fn same_file(left: &Path, right: &Path) -> bool {
    if let (Ok(left), Ok(right)) = (left.canonicalize(), right.canonicalize()) {
        return left == right;
    }
    left == right
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database = open_database(app)?;
            app.manage(database);
            std::thread::spawn(|| {
                let _ = worker::call_value("warm_translator", None);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database_path,
            get_theme,
            set_theme,
            relocate_database,
            reset_shelves,
            reset_tags,
            clear_library,
            list_documents,
            create_document,
            update_document,
            trash_document,
            list_trash,
            restore_document,
            purge_document,
            export_pdf,
            get_document,
            read_document_pdf,
            save_reading_state,
            analyze_document_page,
            ocr_document_region,
            ocr_document_page,
            translate_text,
            list_bookmarks,
            create_bookmark,
            delete_bookmark,
            list_notes,
            create_note,
            update_note,
            delete_note,
            list_dictionary_entries,
            create_dictionary_entry,
            update_dictionary_entry,
            delete_dictionary_entry,
            list_translation_blocks,
            create_translation_block,
            update_translation_block,
            delete_translation_block,
            update_translation_popup,
            list_translation_versions,
            activate_translation_version,
            retranslate_translation_block,
            import_pdf,
            list_shelves,
            create_shelf,
            update_shelf,
            delete_shelf,
            list_tags,
            create_tag,
            update_tag,
            delete_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

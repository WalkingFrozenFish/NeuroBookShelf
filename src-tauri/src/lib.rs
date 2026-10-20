mod db;
mod import;
mod models;
mod seed;
mod storage;
mod worker;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use db::{
    Bookmark, DictionaryEntry, Document, Note, Shelf, Tag, TranslationBlock, TranslationVersion,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const THEMES: &[&str] = &["light", "dark", "sage", "rose", "mist"];
const ACCENTS: &[&str] = &["blue", "teal", "green", "violet", "rose", "amber", "custom"];
const PDF_APPEARANCES: &[&str] = &["original", "dimmed", "night"];

#[derive(Serialize, Deserialize)]
struct Appearance {
    #[serde(default)]
    language: Option<String>,
    mode: String,
    accent: String,
    #[serde(default, rename = "customColor")]
    custom_color: Option<String>,
    pdf: String,
}

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
    #[serde(default)]
    language: Option<String>,
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default)]
    accent: Option<String>,
    #[serde(default)]
    custom_color: Option<String>,
    #[serde(default = "default_pdf_appearance")]
    pdf_appearance: String,
}

fn default_pdf_appearance() -> String {
    "original".to_string()
}

fn default_theme() -> String {
    "light".to_string()
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            database_path: None,
            language: None,
            theme: default_theme(),
            accent: None,
            custom_color: None,
            pdf_appearance: default_pdf_appearance(),
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
fn open_database_folder(db: State<AppDb>) -> Result<(), String> {
    let path = db
        .path
        .lock()
        .map_err(|_| "Не удалось обратиться к базе".to_string())?
        .clone();
    let folder = path
        .parent()
        .ok_or_else(|| "Не удалось определить папку базы".to_string())?;

    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("explorer.exe");
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");

    command
        .arg(folder)
        .spawn()
        .map_err(|err| format!("Не удалось открыть папку базы: {err}"))?;
    Ok(())
}

#[tauri::command]
fn get_appearance(db: State<AppDb>) -> Appearance {
    appearance_from_settings(&read_settings(&db.settings_path))
}

#[tauri::command]
fn set_appearance(db: State<AppDb>, appearance: Appearance) -> Result<(), String> {
    if !["light", "dark"].contains(&appearance.mode.as_str())
        || !ACCENTS.contains(&appearance.accent.as_str())
        || appearance
            .language
            .as_ref()
            .is_some_and(|lang| !["ru", "en"].contains(&lang.as_str()))
        || appearance
            .custom_color
            .as_ref()
            .is_some_and(|color| !valid_color(color))
        || !PDF_APPEARANCES.contains(&appearance.pdf.as_str())
    {
        return Err("Неизвестные параметры оформления".to_string());
    }
    update_settings(&db, |settings| {
        settings.language = appearance.language;
        settings.theme = appearance.mode;
        settings.accent = Some(appearance.accent);
        settings.custom_color = appearance.custom_color;
        settings.pdf_appearance = appearance.pdf;
    })
}

fn valid_color(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn appearance_from_settings(settings: &StoredSettings) -> Appearance {
    let legacy_accent = match settings.theme.as_str() {
        "sage" => "green",
        "rose" => "rose",
        "mist" => "teal",
        _ => "blue",
    };
    Appearance {
        language: Some(
            settings
                .language
                .as_deref()
                .filter(|lang| ["ru", "en"].contains(lang))
                .unwrap_or("ru")
                .to_string(),
        ),
        custom_color: settings
            .custom_color
            .as_ref()
            .filter(|color| valid_color(color))
            .cloned(),
        mode: if settings.theme == "dark" {
            "dark"
        } else {
            "light"
        }
        .to_string(),
        accent: settings
            .accent
            .as_deref()
            .filter(|accent| ACCENTS.contains(accent))
            .unwrap_or(legacy_accent)
            .to_string(),
        pdf: if PDF_APPEARANCES.contains(&settings.pdf_appearance.as_str()) {
            settings.pdf_appearance.clone()
        } else {
            default_pdf_appearance()
        },
    }
}

#[tauri::command]
fn relocate_database(app: tauri::AppHandle, db: State<AppDb>) -> Result<Option<String>, String> {
    if portable_directory().is_some() {
        return Err("В portable-режиме база находится в user-data. Для переноса переместите всю папку приложения.".to_string());
    }
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
fn seed_mock_library(db: State<AppDb>) -> Result<String, String> {
    let documents_dir = db.documents_dir.clone();
    let trash_dir = db.trash_dir.clone();
    with_conn(db, |conn| {
        seed::seed_mock_library(conn, &documents_dir, &trash_dir)
    })
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
    with_conn(db, |conn| {
        db::create_document(conn, &title, &shelf_ids, &tag_ids)
    })
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
    source_language: Option<String>,
    target_language: Option<String>,
) -> Result<worker::WorkerResponse, String> {
    let settings = models::get_translation_settings();
    worker_call(
        "translate",
        Some(serde_json::json!({
            "text": text,
            "sourceLanguage": source_language.unwrap_or(settings.source_language),
            "targetLanguage": target_language.unwrap_or(settings.target_language),
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
    with_conn(db, |conn| {
        db::create_note(conn, document_id, page_number, &body)
    })
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
fn delete_document_notes(db: State<AppDb>, document_id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_document_notes(conn, document_id))
}

#[tauri::command]
fn list_dictionary_entries(
    db: State<AppDb>,
    scope: String,
    document_id: Option<i64>,
    query: String,
) -> Result<Vec<DictionaryEntry>, String> {
    with_conn(db, |conn| {
        db::list_dictionary_entries(conn, &scope, document_id, &query)
    })
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
        db::create_dictionary_entry(
            conn,
            &scope,
            document_id,
            &source_text,
            &translated_text,
            &note,
        )
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
    with_conn(db, |conn| {
        db::update_dictionary_entry(conn, id, &source_text, &translated_text, &note)
    })
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
    with_conn(db, |conn| {
        db::update_translation_block(conn, id, &ocr_text, &translated_text)
    })
}

#[tauri::command]
fn delete_translation_block(db: State<AppDb>, id: i64) -> Result<(), String> {
    with_conn(db, |conn| db::delete_translation_block(conn, id))
}

#[tauri::command]
fn delete_document_translations(db: State<AppDb>, document_id: i64) -> Result<(), String> {
    with_conn(db, |conn| {
        db::delete_document_translations(conn, document_id)
    })
}

#[tauri::command]
fn list_translation_versions(
    db: State<AppDb>,
    block_id: i64,
) -> Result<Vec<TranslationVersion>, String> {
    with_conn(db, |conn| db::list_translation_versions(conn, block_id))
}

#[tauri::command]
fn activate_translation_version(
    db: State<AppDb>,
    version_id: i64,
) -> Result<TranslationBlock, String> {
    with_conn(db, |conn| {
        db::activate_translation_version(conn, version_id)
    })
}

#[tauri::command]
async fn retranslate_translation_block(
    db: State<'_, AppDb>,
    id: i64,
) -> Result<TranslationBlock, String> {
    let ocr_text = with_conn(db.clone(), |conn| db::translation_block_ocr(conn, id))?;
    let settings = models::get_translation_settings();
    let response = worker_call(
        "translate",
        Some(serde_json::json!({
            "text": ocr_text,
            "sourceLanguage": settings.source_language,
            "targetLanguage": settings.target_language,
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
    with_conn(db, |conn| {
        db::add_translation_version(conn, id, translated, translator)
    })
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

fn portable_directory() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let executable = std::env::current_exe().ok()?;
    let directory = executable.parent()?;
    directory
        .join("portable.flag")
        .is_file()
        .then(|| directory.to_path_buf())
}

fn data_root(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(path) = std::env::var_os("LLR_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    if let Some(directory) = portable_directory() {
        return Ok(directory.join("user-data"));
    }
    Ok(app.path().app_data_dir()?)
}

fn open_database(app: &tauri::App) -> Result<AppDb, Box<dyn std::error::Error>> {
    let root = data_root(app)?;
    let data_dir = root.join("data");
    let documents_dir = root.join("library").join("documents");
    let trash_dir = root.join("library").join("trash");
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&documents_dir)?;
    std::fs::create_dir_all(&trash_dir)?;
    let settings_path = root.join("settings.json");
    let mut settings = read_settings(&settings_path);
    let portable = portable_directory().is_some();
    // A portable library must not reopen an absolute database path on the old PC.
    if portable {
        settings.database_path = None;
    }
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
    if portable {
        db::rebase_portable_paths(&conn, &documents_dir, &trash_dir)?;
    }
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

#[cfg(test)]
mod appearance_tests {
    use super::*;

    #[test]
    fn legacy_themes_migrate_without_losing_their_color() {
        for (theme, mode, accent) in [
            ("light", "light", "blue"),
            ("dark", "dark", "blue"),
            ("sage", "light", "green"),
            ("rose", "light", "rose"),
            ("mist", "light", "teal"),
        ] {
            let settings: StoredSettings = serde_json::from_value(serde_json::json!({
                "theme": theme, "databasePath": "example.db"
            }))
            .unwrap();
            let appearance = appearance_from_settings(&settings);
            assert_eq!(appearance.mode, mode);
            assert_eq!(appearance.accent, accent);
            assert_eq!(appearance.pdf, "original");
            assert_eq!(settings.database_path.as_deref(), Some("example.db"));
        }
    }

    #[test]
    fn appearance_round_trips_with_database_settings() {
        for accent in ACCENTS {
            for pdf in PDF_APPEARANCES {
                let settings = StoredSettings {
                    theme: "dark".to_string(),
                    accent: Some(accent.to_string()),
                    pdf_appearance: pdf.to_string(),
                    ..StoredSettings::default()
                };
                let saved = serde_json::to_string(&settings).unwrap();
                let restored = appearance_from_settings(&serde_json::from_str(&saved).unwrap());
                assert_eq!(restored.mode, "dark");
                assert_eq!(restored.accent, *accent);
                assert_eq!(restored.pdf, *pdf);
            }
        }
    }

    #[test]
    fn custom_color_and_language_survive_settings_round_trip() {
        let settings = StoredSettings {
            theme: "dark".into(),
            accent: Some("custom".into()),
            custom_color: Some("#ea681e".into()),
            language: Some("en".into()),
            ..StoredSettings::default()
        };
        let saved = serde_json::to_string(&settings).unwrap();
        let restored = appearance_from_settings(&serde_json::from_str(&saved).unwrap());
        assert_eq!(restored.language.as_deref(), Some("en"));
        assert_eq!(restored.custom_color.as_deref(), Some("#ea681e"));
        assert_eq!(restored.accent, "custom");
        assert!(valid_color("#12ABef"));
        assert!(!valid_color("#12xyef"));
        assert!(!valid_color("red"));
    }

    #[test]
    fn invalid_appearance_fields_fall_back_independently() {
        let settings = StoredSettings {
            theme: "dark".to_string(),
            accent: Some("unknown".to_string()),
            pdf_appearance: "unknown".to_string(),
            ..StoredSettings::default()
        };
        let appearance = appearance_from_settings(&settings);
        assert_eq!(appearance.mode, "dark");
        assert_eq!(appearance.accent, "blue");
        assert_eq!(appearance.pdf, "original");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            worker::initialize(app.path().resource_dir()?, data_root(app)?.join("models"));
            let database = open_database(app)?;
            app.manage(database);
            std::thread::spawn(|| {
                let _ = worker::call_value("warm_translator", None);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            models::model_status,
            models::refresh_model_catalog,
            models::get_translation_settings,
            models::set_translation_settings,
            models::install_models,
            models::cancel_model_download,
            models::select_translation_model,
            database_path,
            open_database_folder,
            get_appearance,
            set_appearance,
            relocate_database,
            reset_shelves,
            reset_tags,
            clear_library,
            seed_mock_library,
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
            delete_document_notes,
            list_dictionary_entries,
            create_dictionary_entry,
            update_dictionary_entry,
            delete_dictionary_entry,
            list_translation_blocks,
            create_translation_block,
            update_translation_block,
            delete_translation_block,
            delete_document_translations,
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

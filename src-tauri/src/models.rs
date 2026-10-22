use crate::worker;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};

static INSTALLING: AtomicBool = AtomicBool::new(false);

fn manifest() -> Value {
    let mut bundled: Value =
        serde_json::from_str(include_str!("../../python-worker/model-manifest.json"))
            .expect("valid model manifest");
    if let Some(cached) = read_json("catalog.json") {
        if let Some(groups) = cached["groups"].as_array() {
            let current = bundled["groups"].as_array_mut().unwrap();
            for group in groups {
                if group["target"].as_str().is_some_and(valid_pair)
                    && group.get("archive").is_some()
                {
                    current.retain(|item| item["target"] != group["target"]);
                    current.push(group.clone());
                }
            }
        }
    }
    // Keep installed packages visible even if a later remote catalog omits them.
    if let Ok(entries) = std::fs::read_dir(worker::models_root()) {
        for entry in entries.flatten() {
            let pair = entry.file_name().to_string_lossy().into_owned();
            let current = bundled["groups"].as_array_mut().unwrap();
            if valid_pair(&pair)
                && translation_ready(&pair)
                && !current.iter().any(|group| group["target"] == pair)
            {
                let metadata: Value = std::fs::read(entry.path().join("metadata.json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                    .unwrap_or(json!({}));
                current.push(
                    json!({"target": pair, "name": "Argos Translate", "archive": {},
                    "packageVersion": metadata["package_version"].as_str().unwrap_or("—")}),
                );
            }
        }
    }
    bundled
}

fn read_json(name: &str) -> Option<Value> {
    std::fs::read(worker::models_root().join(name))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn valid_language(code: &str) -> bool {
    (2..=3).contains(&code.len()) && code.bytes().all(|ch| ch.is_ascii_lowercase())
}

fn valid_pair(pair: &str) -> bool {
    pair.split_once('-')
        .is_some_and(|(source, target)| valid_language(source) && valid_language(target))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSettings {
    pub source_language: String,
    pub target_language: String,
}

#[tauri::command]
pub fn get_translation_settings() -> TranslationSettings {
    let value = read_json("translation-choice.json").unwrap_or(json!({}));
    let legacy = value["pair"].as_str().unwrap_or("en-ru");
    let target = value["targetLanguage"]
        .as_str()
        .unwrap_or_else(|| legacy.split_once('-').map(|p| p.1).unwrap_or("ru"));
    let source = value["sourceLanguage"].as_str().unwrap_or("auto");
    TranslationSettings {
        source_language: if source == "auto" || valid_language(source) {
            source
        } else {
            "auto"
        }
        .into(),
        target_language: if valid_language(target) { target } else { "ru" }.into(),
    }
}

#[tauri::command]
pub fn set_translation_settings(settings: TranslationSettings) -> Result<(), String> {
    if (settings.source_language != "auto" && !valid_language(&settings.source_language))
        || !valid_language(&settings.target_language)
    {
        return Err("Некорректное направление перевода".into());
    }
    let root = worker::models_root();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let temporary = root.join("translation-choice.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, root.join("translation-choice.json")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_model_catalog() -> Result<worker::WorkerResponse, String> {
    tauri::async_runtime::spawn_blocking(|| worker::call_value("refresh_model_catalog", None))
        .await
        .map_err(|e| e.to_string())?
}

pub fn selected_pair() -> String {
    std::fs::read(worker::models_root().join("translation-choice.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value["pair"].as_str().map(str::to_string))
        .filter(|pair| {
            manifest()["groups"].as_array().is_some_and(|groups| {
                groups
                    .iter()
                    .any(|g| g["target"] == *pair && g.get("archive").is_some())
            })
        })
        .unwrap_or_else(|| "en-ru".to_string())
}

fn translation_path(pair: &str) -> std::path::PathBuf {
    let root = worker::models_root();
    let mut path = root.join(pair);
    if pair == "en-ru" {
        if let Ok(value) = std::env::var("LLR_TRANSLATION_MODEL") {
            return value.into();
        }
    }
    if cfg!(debug_assertions) && !path.join("model.bin").is_file() {
        let development = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../python-worker/models")
            .join(pair);
        if development.join("model.bin").is_file() {
            path = development;
        }
    }
    path
}

fn translation_ready(pair: &str) -> bool {
    let path = translation_path(pair);
    ["model.bin", "sentencepiece.model"]
        .iter()
        .all(|name| path.join(name).is_file())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    translation_ready: bool,
    ocr_ready: bool,
    bundled_runtime: bool,
    installing: bool,
    models_path: String,
    download_bytes: u64,
    active_pair: String,
    catalog: Vec<Value>,
    progress: Option<Value>,
    settings: TranslationSettings,
    catalog_updated_at: Option<f64>,
    last_translation: Option<Value>,
}

#[tauri::command]
pub fn model_status() -> ModelStatus {
    let root = worker::models_root();
    let active = selected_pair();
    let manifest = manifest();
    let groups = manifest["groups"].as_array().expect("model groups");
    let group_bytes = |group: &Value| {
        group["archive"]["size"].as_u64().unwrap_or_else(|| {
            group["files"]
                .as_array()
                .map(|files| files.iter().map(|f| f["size"].as_u64().unwrap_or(0)).sum())
                .unwrap_or(0)
        })
    };
    let mut catalog: Vec<Value> = groups.iter().filter(|g| g.get("archive").is_some()).map(|g| {
        let pair = g["target"].as_str().unwrap_or_default();
        let (source, target) = pair.split_once('-').unwrap_or(("en", "ru"));
        let installed_version = std::fs::read(translation_path(pair).join("metadata.json")).ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| value["package_version"].as_str().map(str::to_string));
        json!({"pair": pair, "name": "Argos Translate", "bytes": group_bytes(g), "ready": translation_ready(pair), "installedVersion": installed_version,
            "source": source, "target": target, "version": g["packageVersion"].as_str().unwrap_or("1.9"),
            "sourceName": g["sourceName"].as_str().unwrap_or(source), "targetName": g["targetName"].as_str().unwrap_or(target)})
    }).collect();
    catalog.sort_by(|a, b| a["pair"].as_str().cmp(&b["pair"].as_str()));
    ModelStatus {
        translation_ready: translation_ready(&active),
        ocr_ready: ["det", "rec"].iter().all(|part| {
            ["inference.json", "inference.pdiparams", "inference.yml"]
                .iter()
                .all(|name| root.join("ocr").join(part).join(name).is_file())
        }),
        bundled_runtime: worker::runtime_available(),
        installing: INSTALLING.load(Ordering::SeqCst),
        models_path: root.display().to_string(),
        download_bytes: groups
            .iter()
            .filter(|g| g.get("archive").is_none() || g["target"] == active)
            .map(group_bytes)
            .sum(),
        active_pair: active,
        catalog,
        progress: std::fs::read(root.join("download-progress.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok()),
        settings: get_translation_settings(),
        catalog_updated_at: read_json("catalog.json").and_then(|value| value["updatedAt"].as_f64()),
        last_translation: read_json("last-translation.json"),
    }
}

#[tauri::command]
pub fn select_translation_model(pair: String) -> Result<(), String> {
    if !manifest()["groups"]
        .as_array()
        .unwrap()
        .iter()
        .any(|g| g["target"] == pair && g.get("archive").is_some())
    {
        return Err("Неизвестная языковая пара".into());
    }
    if !translation_ready(&pair) {
        return Err("Сначала загрузите модель".into());
    }
    let root = worker::models_root();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let temporary = root.join("translation-choice.tmp");
    std::fs::write(&temporary, json!({"pair": pair}).to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, root.join("translation-choice.json")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_model_download() -> Result<(), String> {
    if INSTALLING.load(Ordering::SeqCst) {
        std::fs::write(worker::models_root().join("cancel-download"), b"cancel")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn install_models(pair: Option<String>) -> Result<worker::WorkerResponse, String> {
    let pair = pair.unwrap_or_else(selected_pair);
    if pair != "ocr"
        && !manifest()["groups"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g["target"] == pair && g.get("archive").is_some())
    {
        return Err("Неизвестная языковая пара".into());
    }
    if INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Модели уже загружаются".to_string());
    }
    let root = worker::models_root();
    let prepare = std::fs::create_dir_all(&root).and_then(|_| {
        match std::fs::remove_file(root.join("cancel-download")) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    });
    if let Err(error) = prepare {
        INSTALLING.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    let _ = std::fs::write(
        root.join("download-progress.json"),
        json!({"phase": "starting", "downloaded": 0, "total": 0}).to_string(),
    );
    let response = tauri::async_runtime::spawn_blocking(move || {
        worker::call_value("install_models", Some(json!({"pair": pair})))
    })
    .await;
    INSTALLING.store(false, Ordering::SeqCst);
    response.map_err(|error| error.to_string())?
}

use crate::worker;
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    translation_ready: bool,
    ocr_ready: bool,
    bundled_runtime: bool,
    installing: bool,
    models_path: String,
    download_bytes: u64,
    progress: Option<Value>,
}

#[tauri::command]
pub fn model_status() -> ModelStatus {
    let root = worker::models_root();
    let translation_override = std::env::var("LLR_TRANSLATION_MODEL")
        .ok()
        .map(std::path::PathBuf::from);
    let mut translation = translation_override.unwrap_or_else(|| root.join("en-ru"));
    if cfg!(debug_assertions) && !translation.join("model.bin").is_file() {
        translation = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../python-worker/models/en-ru");
    }
    let manifest: Value =
        serde_json::from_str(include_str!("../../python-worker/model-manifest.json"))
            .unwrap_or_default();
    let download_bytes = manifest["groups"]
        .as_array()
        .map(|groups| {
            groups
                .iter()
                .map(|group| {
                    group["archive"]["size"].as_u64().unwrap_or_else(|| {
                        group["files"]
                            .as_array()
                            .map(|files| {
                                files
                                    .iter()
                                    .map(|file| file["size"].as_u64().unwrap_or(0))
                                    .sum()
                            })
                            .unwrap_or(0)
                    })
                })
                .sum()
        })
        .unwrap_or(0);
    ModelStatus {
        translation_ready: ["model.bin", "sentencepiece.model"]
            .iter()
            .all(|name| translation.join(name).is_file()),
        ocr_ready: ["det", "rec"].iter().all(|part| {
            ["inference.json", "inference.pdiparams", "inference.yml"]
                .iter()
                .all(|name| root.join("ocr").join(part).join(name).is_file())
        }),
        bundled_runtime: worker::runtime_available(),
        installing: INSTALLING.load(Ordering::SeqCst),
        models_path: root.display().to_string(),
        download_bytes,
        progress: std::fs::read(root.join("download-progress.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok()),
    }
}

#[tauri::command]
pub async fn install_models() -> Result<worker::WorkerResponse, String> {
    if INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Модели уже загружаются".to_string());
    }
    let response =
        tauri::async_runtime::spawn_blocking(|| worker::call_value("install_models", None)).await;
    INSTALLING.store(false, Ordering::SeqCst);
    response.map_err(|error| error.to_string())?
}

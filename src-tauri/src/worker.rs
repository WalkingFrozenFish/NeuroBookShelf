use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkerResponse {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<WorkerError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkerError {
    pub code: String,
    pub message: String,
}

#[derive(Debug)]
enum WorkerFailure {
    NotFound(String),
    Failed(String),
}

#[cfg(test)]
pub fn call(command: &str, payload: Option<&str>) -> Result<WorkerResponse, String> {
    call_value(command, payload.map(|value| Value::String(value.to_string())))
}

pub fn call_value(command: &str, payload: Option<Value>) -> Result<WorkerResponse, String> {
    let mut request = Map::new();
    request.insert("command".to_string(), Value::String(command.to_string()));
    if let Some(payload) = payload {
        request.insert("payload".to_string(), payload);
    }
    let timeout = if command == "ocr_region"
        || command == "ocr_page"
        || command == "translate"
        || command == "warm_translator"
    {
        Duration::from_secs(300)
    } else {
        Duration::from_secs(30)
    };
    call_line(&Value::Object(request).to_string(), timeout)
}

fn call_line(line: &str, timeout: Duration) -> Result<WorkerResponse, String> {
    let script = script_path();
    if !script.is_file() {
        return Err(format!(
            "Файл Python worker не найден: {}",
            script.display()
        ));
    }
    let program = selected_program()?;
    match session_call(&program, &script, line, timeout) {
        Ok(response) => Ok(response),
        Err(WorkerFailure::NotFound(name)) => Err(format!(
            "Python не найден. Установите Python 3 и убедитесь, что команда python доступна. Проверено: {name}."
        )),
        Err(WorkerFailure::Failed(message)) => Err(message),
    }
}

fn script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../python-worker/worker.py")
}

struct Session {
    child: Child,
    stdin: ChildStdin,
    incoming: mpsc::Receiver<std::io::Result<String>>,
    stderr: std::sync::Arc<Mutex<String>>,
}

fn session_slot() -> &'static Mutex<Option<Session>> {
    static SLOT: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn session_call(
    program: &[String],
    script: &PathBuf,
    line: &str,
    timeout: Duration,
) -> Result<WorkerResponse, WorkerFailure> {
    let mut session = session_slot()
        .lock()
        .map_err(|_| WorkerFailure::Failed("Не удалось обратиться к Python worker".to_string()))?;
    if session.is_none() {
        *session = Some(spawn_session(program, script)?);
    }
    let wrote = {
        let current = session.as_mut().unwrap();
        writeln!(current.stdin, "{line}").and_then(|_| current.stdin.flush()).is_ok()
    };
    if !wrote {
        return Err(WorkerFailure::Failed(close_session(
            &mut session,
            "Не удалось передать команду Python worker",
        )));
    }
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(WorkerFailure::Failed(close_session(
                &mut session,
                "Python worker не ответил",
            )));
        }
        let received = session.as_mut().unwrap().incoming.recv_timeout(remaining);
        match received {
            Ok(Ok(response)) => {
                let response = response.trim();
                if response.is_empty() || !response.starts_with('{') {
                    continue;
                }
                return serde_json::from_str(response).map_err(|error| {
                    WorkerFailure::Failed(format!(
                        "Python worker вернул не JSON: {error}. Ответ: {response}"
                    ))
                });
            }
            Ok(Err(error)) => {
                return Err(WorkerFailure::Failed(close_session(
                    &mut session,
                    &format!("Не удалось прочитать ответ Python worker: {error}"),
                )));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(WorkerFailure::Failed(close_session(
                    &mut session,
                    "Python worker не ответил",
                )));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(WorkerFailure::Failed(close_session(
                    &mut session,
                    "Python worker завершился без ответа",
                )));
            }
        }
    }
}

fn spawn_session(program: &[String], script: &PathBuf) -> Result<Session, WorkerFailure> {
    let mut child = spawn_worker(program, script)?;
    let stdin = child.stdin.take().ok_or_else(|| {
        let _ = child.kill();
        WorkerFailure::Failed("Не удалось передать команду Python worker".to_string())
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        WorkerFailure::Failed("Не удалось прочитать ответ Python worker".to_string())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.kill();
        WorkerFailure::Failed("Не удалось прочитать ошибку Python worker".to_string())
    })?;
    let (sender, incoming) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = sender.send(Ok(String::new()));
                    break;
                }
                Ok(_) => {
                    if sender.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Err(error));
                    break;
                }
            }
        }
    });
    let stderr_log = std::sync::Arc::new(Mutex::new(String::new()));
    let stderr_write = stderr_log.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            if let Ok(mut log) = stderr_write.lock() {
                log.push_str(&line);
                if log.len() > 4000 {
                    let extra = log.len() - 4000;
                    log.drain(..extra);
                }
            }
        }
    });
    Ok(Session {
        child,
        stdin,
        incoming,
        stderr: stderr_log,
    })
}

fn close_session(session: &mut Option<Session>, reason: &str) -> String {
    let stderr_text = session
        .as_ref()
        .and_then(|item| item.stderr.lock().ok())
        .map(|log| log.trim().to_string())
        .unwrap_or_default();
    if let Some(mut current) = session.take() {
        let _ = current.child.kill();
        let _ = current.child.wait();
    }
    failure_message(reason, &stderr_text)
}

fn selected_program() -> Result<Vec<String>, String> {
    static CACHE: OnceLock<Mutex<Option<Vec<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut cache = cache
        .lock()
        .map_err(|_| "Не удалось выбрать интерпретатор Python".to_string())?;
    if let Some(program) = cache.clone() {
        return Ok(program);
    }
    let mut pdf_only = None;
    let mut checked = Vec::new();
    for program in candidates() {
        checked.push(program.join(" "));
        match probe(&program) {
            Probe::Ocr => {
                *cache = Some(program.clone());
                return Ok(program);
            }
            Probe::Pdf if pdf_only.is_none() => pdf_only = Some(program),
            Probe::Pdf | Probe::Missing => {}
        }
    }
    if let Some(program) = pdf_only {
        *cache = Some(program.clone());
        return Ok(program);
    }
    Err(format!(
        "Python не найден. Установите Python 3 и убедитесь, что команда python доступна. Проверено: {}.",
        checked.join(", ")
    ))
}

enum Probe {
    Ocr,
    Pdf,
    Missing,
}

fn probe(program: &[String]) -> Probe {
    let Some((executable, prefix)) = program.split_first() else {
        return Probe::Missing;
    };
    let output = Command::new(executable)
        .args(prefix)
        .arg("-c")
        .arg(
            "import importlib.util\ntry:\n import pymupdf\nexcept Exception:\n raise SystemExit(1)\nprint('ocr' if importlib.util.find_spec('paddleocr') else 'pdf')",
        )
        .output();
    let Ok(output) = output else {
        return Probe::Missing;
    };
    if !output.status.success() {
        return Probe::Missing;
    }
    match String::from_utf8_lossy(&output.stdout)
        .lines()
        .last()
        .unwrap_or("")
        .trim()
    {
        "ocr" => Probe::Ocr,
        "pdf" => Probe::Pdf,
        _ => Probe::Missing,
    }
}

fn candidates() -> Vec<Vec<String>> {
    if let Ok(custom) = std::env::var("LLR_PYTHON") {
        let custom = custom.trim();
        if !custom.is_empty() {
            return vec![vec![custom.to_string()]];
        }
    }
    if cfg!(windows) {
        vec![
            vec!["py".to_string(), "-3.12".to_string()],
            vec!["py".to_string(), "-3.11".to_string()],
            vec!["py".to_string(), "-3.10".to_string()],
            vec!["python".to_string()],
            vec!["py".to_string(), "-3".to_string()],
        ]
    } else {
        vec![vec!["python3".to_string()], vec!["python".to_string()]]
    }
}

fn spawn_worker(program: &[String], script: &PathBuf) -> Result<Child, WorkerFailure> {
    let Some((executable, prefix)) = program.split_first() else {
        return Err(WorkerFailure::Failed(
            "Не указан интерпретатор Python".to_string(),
        ));
    };
    let mut command = Command::new(executable);
    command
        .args(prefix)
        .arg("-u")
        .arg(script)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("KMP_DUPLICATE_LIB_OK", "TRUE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            WorkerFailure::NotFound(executable.clone())
        } else {
            WorkerFailure::Failed(format!("Не удалось запустить Python worker: {error}"))
        }
    })
}

#[cfg_attr(not(test), allow(dead_code))]
fn exchange(program: &[String], script: &PathBuf, line: &str) -> Result<WorkerResponse, WorkerFailure> {
    let mut child = spawn_worker(program, script)?;

    let mut stdin = child.stdin.take().ok_or_else(|| {
        let _ = child.kill();
        WorkerFailure::Failed("Не удалось передать команду Python worker".to_string())
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        WorkerFailure::Failed("Не удалось прочитать ответ Python worker".to_string())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.kill();
        WorkerFailure::Failed("Не удалось прочитать ошибку Python worker".to_string())
    })?;
    let stderr_thread = thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut text);
        text
    });

    let write_result = writeln!(stdin, "{line}");
    drop(stdin);
    if let Err(error) = write_result {
        stop(&mut child);
        let _ = stderr_thread.join();
        return Err(WorkerFailure::Failed(format!(
            "Не удалось передать команду Python worker: {error}"
        )));
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut response = String::new();
        let result = reader.read_line(&mut response);
        let _ = sender.send((result, response));
    });

    let received = receiver.recv_timeout(Duration::from_secs(30));
    let (read_result, response_line) = match received {
        Ok(value) => value,
        Err(_) => {
            stop(&mut child);
            let stderr_text = stderr_thread.join().unwrap_or_default();
            return Err(WorkerFailure::Failed(failure_message(
                "Python worker не ответил",
                &stderr_text,
            )));
        }
    };
    let status = child.wait().map_err(|error| {
        WorkerFailure::Failed(format!("Не удалось дождаться Python worker: {error}"))
    })?;
    let stderr_text = stderr_thread.join().unwrap_or_default();
    read_result.map_err(|error| {
        WorkerFailure::Failed(failure_message(
            &format!("Не удалось прочитать ответ Python worker: {error}"),
            &stderr_text,
        ))
    })?;
    let response_line = response_line.trim();
    if response_line.is_empty() {
        let reason = if status.success() {
            "Python worker завершился без ответа"
        } else {
            "Python worker завершился с ошибкой"
        };
        return Err(WorkerFailure::Failed(failure_message(reason, &stderr_text)));
    }
    serde_json::from_str(response_line).map_err(|error| {
        WorkerFailure::Failed(format!(
            "Python worker вернул не JSON: {error}. Ответ: {response_line}"
        ))
    })
}

#[cfg_attr(not(test), allow(dead_code))]
fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn failure_message(reason: &str, stderr_text: &str) -> String {
    let stderr_text = stderr_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && *line != "ocr-engine-ready" && *line != "translator-ready")
        .collect::<Vec<_>>()
        .join(" ");
    if stderr_text.is_empty() {
        reason.to_string()
    } else {
        format!("{reason}: {stderr_text}")
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::process::Stdio;

    use super::*;

    #[test]
    fn ping_echo_unknown_and_invalid_json() {
        let script = script_path();
        let ping = exchange(&interpreter(), &script, r#"{"command":"ping"}"#).unwrap();
        assert_eq!(ping.result, Some(Value::String("pong".to_string())));
        assert!(ping.error.is_none());

        let echo = call("echo", Some("test")).unwrap();
        assert_eq!(echo.result, Some(Value::String("test".to_string())));

        let unknown = call("not-a-command", None).unwrap();
        assert!(!unknown.success);
        assert_eq!(unknown.error.unwrap().code, "UNKNOWN_COMMAND");

        let invalid = exchange(&interpreter(), &script, "{").unwrap();
        assert_eq!(invalid.error.unwrap().code, "INVALID_JSON");
    }

    #[test]
    fn missing_interpreter_is_reported() {
        let error = exchange(
            &["C:/missing/python-stage8.exe".to_string()],
            &script_path(),
            r#"{"command":"ping"}"#,
        )
        .unwrap_err();
        match error {
            WorkerFailure::NotFound(name) => assert!(name.contains("python-stage8")),
            WorkerFailure::Failed(message) => panic!("{message}"),
        }
    }

    #[test]
    fn analyze_page_reads_text_and_reports_errors() {
        let dir = std::env::temp_dir().join("llr-stage9");
        std::fs::create_dir_all(&dir).unwrap();
        let mut child = std::process::Command::new("python")
            .env("FIXTURE_DIR", &dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(FIXTURE_SCRIPT.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );

        let text_path = dir.join("text.pdf");
        let before = std::fs::read(&text_path).unwrap();
        let page = analyze(&text_path, 1);
        let result = page.result.unwrap();
        assert_eq!(result["hasTextLayer"], Value::Bool(true));
        assert_eq!(result["pageNumber"], Value::from(1));
        assert_eq!(result["pageWidth"], Value::from(400.0));
        assert_eq!(result["pageHeight"], Value::from(200.0));
        let blocks = result["blocks"].as_array().unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["text"], "First block");
        assert_eq!(blocks[1]["text"], "Second block");
        assert!(near(&blocks[0]["x"], 0.1));
        assert!(near(&blocks[0]["y"], 0.1));
        assert!(near(&blocks[1]["y"], 0.45));
        assert!(blocks[1]["y"].as_f64().unwrap() > blocks[0]["y"].as_f64().unwrap());
        for block in blocks {
            for key in ["x", "y", "width", "height"] {
                let value = block[key].as_f64().unwrap();
                assert!((0.0..=1.0).contains(&value), "{key}={value}");
            }
        }
        let second = analyze(&text_path, 2);
        let second_blocks = second.result.unwrap()["blocks"].as_array().unwrap().clone();
        assert_eq!(second_blocks.len(), 1);
        assert_eq!(second_blocks[0]["text"], "Only page two");
        assert_eq!(std::fs::read(&text_path).unwrap(), before);

        let scan = analyze(&dir.join("scan.pdf"), 1);
        let scan_result = scan.result.unwrap();
        assert_eq!(scan_result["hasTextLayer"], Value::Bool(false));
        assert!(scan_result["blocks"].as_array().unwrap().is_empty());

        assert_eq!(analyze(&text_path, 0).error.unwrap().code, "INVALID_PAGE");
        assert_eq!(analyze(&text_path, 9).error.unwrap().code, "PAGE_OUT_OF_RANGE");
        assert_eq!(
            analyze(&dir.join("missing.pdf"), 1).error.unwrap().code,
            "FILE_NOT_FOUND"
        );
        assert_eq!(analyze(&dir.join("broken.pdf"), 1).error.unwrap().code, "INVALID_PDF");
        assert_eq!(analyze(&dir.join("locked.pdf"), 1).error.unwrap().code, "PDF_ERROR");
    }

    fn analyze(path: &std::path::Path, page_number: i64) -> WorkerResponse {
        let request = serde_json::json!({
            "command": "analyze_page",
            "payload": {
                "path": path.display().to_string(),
                "pageNumber": page_number,
            }
        });
        exchange(&interpreter(), &script_path(), &request.to_string()).unwrap()
    }

    fn near(value: &Value, expected: f64) -> bool {
        (value.as_f64().unwrap() - expected).abs() < 0.02
    }

    #[test]
    fn ocr_region_reads_text_and_reports_errors() {
        let dir = std::env::temp_dir().join("llr-stage11");
        std::fs::create_dir_all(&dir).unwrap();
        let child = std::process::Command::new("py")
            .args(["-3.10", "-c"])
            .arg(OCR_FIXTURE)
            .env("FIXTURE_DIR", &dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let pdf = dir.join("ocr.pdf");
        let before = std::fs::read(&pdf).unwrap();
        let requests = [
            request(&dir.join("missing.pdf"), 1, 0.1, 0.1, 0.2, 0.2),
            request(&pdf, 1, 0.1, 0.1, 0.0, 0.2),
            request(&pdf, 4, 0.1, 0.1, 0.2, 0.2),
            request(&pdf, 1, 0.05, 0.08, 0.9, 0.75),
            request(&pdf, 1, 0.05, 0.45, 0.75, 0.35),
            request(&pdf, 1, 0.05, 0.88, 0.4, 0.1),
        ];
        let (responses, stderr) = talk(&requests);
        assert_eq!(responses[0].error.as_ref().unwrap().code, "FILE_NOT_FOUND");
        assert_eq!(responses[1].error.as_ref().unwrap().code, "INVALID_REGION");
        assert_eq!(responses[2].error.as_ref().unwrap().code, "PAGE_OUT_OF_RANGE");
        let both = responses[3].result.as_ref().unwrap();
        let both_text = both["text"].as_str().unwrap();
        assert!(both_text.contains("Hello OCR"), "{both_text}");
        assert!(both_text.contains("Small note"), "{both_text}");
        assert!(both["blocks"].as_array().unwrap().len() >= 2);
        let small = responses[4].result.as_ref().unwrap()["text"].as_str().unwrap();
        assert!(small.contains("Small note"), "{small}");
        assert!(!small.contains("Hello"), "{small}");
        let blank = responses[5].result.as_ref().unwrap();
        assert_eq!(blank["text"].as_str().unwrap(), "");
        assert!(blank["blocks"].as_array().unwrap().is_empty());
        assert_eq!(stderr.matches("ocr-engine-ready").count(), 1);
        assert_eq!(std::fs::read(&pdf).unwrap(), before);
    }

    #[test]
    fn translate_reuses_engine_and_reports_errors() {
        let dir = std::env::temp_dir().join("llr-stage12");
        std::fs::create_dir_all(&dir).unwrap();
        let child = std::process::Command::new("py")
            .args(["-3.10", "-c"])
            .arg(OCR_FIXTURE)
            .env("FIXTURE_DIR", &dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let pdf = dir.join("ocr.pdf");
        let requests = vec![
            translate_request("   ", "en", "ru"),
            request(&pdf, 1, 0.05, 0.08, 0.9, 0.75),
            translate_request("The fox is standing near the tree.", "en", "ru"),
            translate_request("Hello", "en", "ru"),
            translate_request("Hello", "fr", "ru"),
            serde_json::json!({
                "command": "translate",
                "payload": { "text": 1, "sourceLanguage": "en", "targetLanguage": "ru" }
            })
            .to_string(),
        ];
        let (responses, stderr) = talk(&requests);
        assert_eq!(responses[0].error.as_ref().unwrap().code, "EMPTY_TEXT");
        assert!(
            responses[1].result.as_ref().unwrap()["text"]
                .as_str()
                .unwrap()
                .contains("Hello OCR")
        );
        assert_eq!(
            responses[2].result.as_ref().unwrap()["translatedText"].as_str().unwrap(),
            "Лиса стоит возле дерева."
        );
        assert_eq!(
            responses[3].result.as_ref().unwrap()["translatedText"].as_str().unwrap(),
            "Привет."
        );
        assert_eq!(responses[4].error.as_ref().unwrap().code, "UNSUPPORTED_LANGUAGE");
        assert_eq!(responses[5].error.as_ref().unwrap().code, "INVALID_PAYLOAD");
        assert_eq!(stderr.matches("translator-ready").count(), 1);
        assert_eq!(stderr.matches("ocr-engine-ready").count(), 1);

        let (missing, _) = talk_env(
            &[translate_request("Hello", "en", "ru")],
            &[("LLR_TRANSLATION_MODEL", "C:/missing/llr-translation-model")],
        );
        assert_eq!(missing[0].error.as_ref().unwrap().code, "MODEL_MISSING");
    }

    fn translate_request(text: &str, source: &str, target: &str) -> String {
        serde_json::json!({
            "command": "translate",
            "payload": {
                "text": text,
                "sourceLanguage": source,
                "targetLanguage": target
            }
        })
        .to_string()
    }

    fn request(path: &std::path::Path, page: i64, x: f64, y: f64, width: f64, height: f64) -> String {
        serde_json::json!({
            "command": "ocr_region",
            "payload": {
                "pdfPath": path.display().to_string(),
                "pageNumber": page,
                "rect": { "x": x, "y": y, "width": width, "height": height }
            }
        })
        .to_string()
    }

    fn talk(lines: &[String]) -> (Vec<WorkerResponse>, String) {
        talk_env(lines, &[])
    }

    fn talk_env(lines: &[String], env: &[(&str, &str)]) -> (Vec<WorkerResponse>, String) {
        let script = script_path();
        let mut command = std::process::Command::new("py");
        command
            .args(["-3.10", "-u"])
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (key, value) in env {
            command.env(key, value);
        }
        let mut child = command.spawn().unwrap();
        {
            let mut stdin = child.stdin.take().unwrap();
            for line in lines {
                writeln!(stdin, "{line}").unwrap();
            }
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        let responses = stdout
            .lines()
            .filter(|line| line.starts_with('{'))
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        (responses, String::from_utf8_lossy(&output.stderr).to_string())
    }

    fn interpreter() -> Vec<String> {
        if cfg!(windows) {
            vec!["python".to_string()]
        } else {
            vec!["python3".to_string()]
        }
    }

    const OCR_FIXTURE: &str = r#"
import os
from pathlib import Path
import pymupdf
root = Path(os.environ["FIXTURE_DIR"])
doc = pymupdf.open()
page = doc.new_page(width=400, height=220)
page.insert_textbox(pymupdf.Rect(40, 30, 360, 90), "Hello OCR", fontsize=28)
page.insert_textbox(pymupdf.Rect(40, 110, 280, 170), "Small note", fontsize=20)
doc.save(root / "ocr.pdf")
doc.close()
"#;

    const FIXTURE_SCRIPT: &str = r#"
import os
from pathlib import Path
import pymupdf

root = Path(os.environ["FIXTURE_DIR"])
doc = pymupdf.open()
page = doc.new_page(width=400, height=200)
page.insert_textbox(pymupdf.Rect(40, 20, 280, 50), "First block")
page.insert_textbox(pymupdf.Rect(40, 90, 280, 130), "Second block")
page2 = doc.new_page(width=400, height=200)
page2.insert_textbox(pymupdf.Rect(40, 40, 300, 80), "Only page two")
doc.save(root / "text.pdf")
doc.close()

image = pymupdf.open()
page = image.new_page(width=300, height=300)
pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), 1)
pix.clear_with(80)
page.insert_image(page.rect, pixmap=pix)
image.save(root / "scan.pdf")
image.close()

locked = pymupdf.open()
locked.new_page().insert_textbox(pymupdf.Rect(40, 40, 200, 80), "Secret")
locked.save(root / "locked.pdf", encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="secret")
locked.close()

(root / "broken.pdf").write_bytes(b"%PDF-1.4\nthis is not a pdf\n")
"#;
}

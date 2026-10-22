import { useEffect, useState } from "react";
import { errorText, installModels, modelStatus, type ModelStatus } from "./libraryApi";

const megabytes = (bytes: number) => `${Math.ceil(bytes / 1024 / 1024)} МБ`;

export function ModelSetup() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void modelStatus().then((value) => {
      if (!active) return;
      setStatus(value);
      if (!value.translationReady || !value.ocrReady) setOpen(true);
    }).catch((failure) => { if (active) setError(errorText(failure)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open && !pending) return;
    let active = true;
    const refresh = () => void modelStatus().then((value) => {
      if (active) setStatus(value);
    }).catch((failure) => { if (active) setError(errorText(failure)); });
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [open, pending]);

  async function install() {
    setPending(true);
    setError("");
    try {
      const response = await installModels();
      if (!response.success) throw new Error(response.error?.message ?? "Не удалось загрузить модели");
      setStatus(await modelStatus());
    } catch (failure) {
      setError(errorText(failure));
    } finally { setPending(false); }
  }

  const busy = pending || status?.installing;
  const ready = status?.translationReady && status?.ocrReady;
  const progress = status?.progress;
  return <>
    <button type="button" className="model-setup-button" onClick={() => setOpen(true)}>
      {busy ? "Модели · загрузка…" : "Модели"}
    </button>
    {open && <div className="model-setup-backdrop">
      <section className="model-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="model-setup-title">
        <h2 id="model-setup-title">Подготовка OCR и перевода</h2>
        <p>Читать PDF можно сразу. Для распознавания сканов и перевода нужны локальные модели. После загрузки они работают без интернета.</p>
        {status ? <>
          <ul>
            <li>Перевод English → Russian: {status.translationReady ? "готов" : "нужна загрузка"}</li>
            <li>Распознавание английского текста: {status.ocrReady ? "готово" : "нужна загрузка"}</li>
          </ul>
          {!ready && <p>Полный комплект: {megabytes(status.downloadBytes)}. Уже загруженные файлы повторно не скачиваются.</p>}
          {busy && <div role="status">
            <p>{progress?.phase === "extracting" ? "Распаковка модели…" : "Загрузка моделей…"} {progress?.file}</p>
            <progress aria-label="Загрузка моделей" max={progress?.total || 1} value={progress?.downloaded ?? 0} />
            <p>{megabytes(progress?.downloaded ?? 0)} / {megabytes(progress?.total || status.downloadBytes)}</p>
          </div>}
          {ready && <p>Всё готово. Можно распознавать и переводить.</p>}
        </> : <p>Проверка компонентов…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!busy && progress?.phase === "error" && !error && <p className="error">{progress.message}</p>}
        <div className="actions">
          {!ready && <button type="button" className="primary" disabled={Boolean(busy) || !status} onClick={() => void install()}>{busy ? "Загрузка…" : "Скачать модели"}</button>}
          <button type="button" onClick={() => setOpen(false)}>{ready ? "Готово" : busy ? "Продолжить в фоне" : "Пока только читать"}</button>
        </div>
        <small>Книги и заметки остаются на этом компьютере. При установке загружаются только файлы моделей из Argos Translate и PaddlePaddle.</small>
      </section>
    </div>}
  </>;
}

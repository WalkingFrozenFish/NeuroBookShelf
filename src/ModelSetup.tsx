import { locale, t } from "./i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cancelModelDownload, errorText, installModels, modelStatus, refreshModelCatalog, setTranslationSettings, type ModelStatus, type TranslationSettings } from "./libraryApi";
import { isPendingJob, translationQueue } from "./translationQueue";
import { languageName, TranslationOptions } from "./TranslationOptions";

const megabytes = (bytes: number) => t("{0} МБ", [Math.ceil(bytes / 1024 / 1024)]);

export function ModelSetup() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [installingPair, setInstallingPair] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [query, setQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const mounted = useRef(true);
  const refreshLock = useRef(false);
  const jobs = useSyncExternalStore(translationQueue.subscribe, translationQueue.getSnapshot);
  const translating = jobs.some(isPendingJob);

  async function updateStatus() {
    const value = await modelStatus();
    if (mounted.current) { setStatus(value); setStatusError(""); }
    return value;
  }

  async function refreshCatalog() {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true); setCatalogError("");
    try {
      const response = await refreshModelCatalog();
      if (!response.success) throw new Error(response.error?.message ?? t("Не удалось обновить каталог"));
      await updateStatus();
    } catch (failure) { if (mounted.current) setCatalogError(errorText(failure)); }
    finally { refreshLock.current = false; if (mounted.current) setRefreshing(false); }
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void updateStatus().then(value => {
      if (active && !value.installing && !translating && (!value.catalogUpdatedAt || Date.now() / 1000 - value.catalogUpdatedAt > 86400)) void refreshCatalog();
    }).catch(failure => { if (active) setStatusError(errorText(failure)); });
    const timer = window.setInterval(() => {
      void updateStatus().catch(failure => { if (active) setStatusError(errorText(failure)); });
    }, 1500);
    return () => { active = false; mounted.current = false; window.clearInterval(timer); };
  }, []);

  async function install(pair: string) {
    setPending(true); setInstallingPair(pair); setCancelling(false); setError("");
    try {
      const response = await installModels(pair);
      if (!response.success && response.error?.code !== "DOWNLOAD_CANCELLED") throw new Error(response.error?.message ?? t("Не удалось загрузить модели"));
      await updateStatus();
    } catch (failure) { if (mounted.current) setError(errorText(failure)); }
    finally { if (mounted.current) { setPending(false); setCancelling(false); setInstallingPair(""); } }
  }
  async function cancel() {
    setCancelling(true);
    try { await cancelModelDownload(); }
    catch (failure) { setError(errorText(failure)); setCancelling(false); }
  }
  async function saveSettings(next: TranslationSettings) {
    setSaving(true); setError("");
    try { await setTranslationSettings(next); await updateStatus(); }
    catch (failure) { if (mounted.current) setError(errorText(failure)); }
    finally { if (mounted.current) setSaving(false); }
  }

  const busy = pending || Boolean(status?.installing);
  const progress = status?.progress;
  const settings = status?.settings ?? { sourceLanguage: "auto", targetLanguage: "ru" };
  const catalog = status?.catalog ?? [];
  const filtered = catalog.filter(item => (!installedOnly || item.ready) &&
    `${item.name} ${item.pair} ${languageName(item.source)} ${languageName(item.target)} ${item.sourceName} ${item.targetName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const usedPairs = status?.lastTranslation?.pairs ?? [];
  const currentlyTranslating = status?.lastTranslation?.phase === "translating" && Date.now() / 1000 - status.lastTranslation.updatedAt < 300;

  return <section className="settings-block model-settings" aria-labelledby="model-setup-title">
    <h3 id="model-setup-title">{t("Модели и перевод")}</h3>
    <p className="meta">{t("Установленные модели выбираются автоматически для каждого фрагмента. Текст на целевом языке остаётся без перевода.")}</p>
    <TranslationOptions settings={settings} catalog={catalog} disabled={saving || !status} onChange={next => void saveSettings(next)} />
    <p className="meta">{t("Для уже добавленных задач направление сохраняется. Сохранённые переводы автоматически не меняются.")}</p>
    {translating && <p className="meta">{t("Очередь продолжает работу с выбранным при добавлении направлением.")}</p>}
    {status?.lastTranslation && <p className="model-usage" role="status">
      <strong>{currentlyTranslating ? t("Сейчас переводится:") : t("Последний перевод:")}</strong>{" "}
      {status.lastTranslation.sourceLanguages.map(languageName).join(", ")} → {languageName(status.lastTranslation.targetLanguage)}
      <span>{t("Модели:")} {usedPairs.length ? usedPairs.join(" · ") : t("Не требуются — текст уже на целевом языке")}</span>
    </p>}
    <div className="model-catalog-heading">
      <h4>{t("Каталог Argos Translate")}</h4>
      <button type="button" disabled={refreshing || busy || translating} onClick={() => void refreshCatalog()}>{refreshing ? t("Обновление…") : t("Обновить каталог")}</button>
    </div>
    <p className="meta">{status?.catalogUpdatedAt ? t("Каталог обновлён: {0}", [new Date(status.catalogUpdatedAt * 1000).toLocaleString(locale())]) : t("Показан встроенный список. Обновите каталог для получения доступных моделей.")}</p>
    {catalogError && <p className="error" role="alert">{t("Каталог недоступен. Сохранённый список и установленные модели доступны.")} {catalogError}</p>}
    <div className="model-catalog-filters">
      <input type="search" aria-label={t("Поиск моделей")} placeholder={t("Поиск по языку или локали")} value={query} onChange={event => setQuery(event.target.value)} />
      <label><input type="checkbox" checked={installedOnly} onChange={event => setInstalledOnly(event.target.checked)} />{t("Только установленные")}</label>
    </div>
    <div className="model-table-scroll">
      <table className="model-table">
        <caption className="sr-only">{t("Доступные модели перевода")}</caption>
        <thead><tr><th scope="col">{t("Модель")}</th><th scope="col">{t("Направление")}</th><th scope="col">{t("Версия")}</th><th scope="col">{t("Состояние")}</th><th scope="col">{t("Действие")}</th></tr></thead>
        <tbody>{filtered.map(item => <tr key={item.pair} className={usedPairs.includes(item.pair) ? "model-used" : undefined}>
          <td>{item.name}</td>
          <td>{languageName(item.source)} → {languageName(item.target)}<small>{item.source} → {item.target}</small></td>
          <td>{item.ready && item.installedVersion ? item.installedVersion : item.version}</td>
          <td>{item.ready ? t("Установлена") : t("Не установлена")}{usedPairs.includes(item.pair) && <small>{currentlyTranslating ? t("В работе") : t("Использовалась")}</small>}</td>
          <td>{item.ready ? <span className="meta">{t("Выбирается автоматически")}</span> : <button type="button" className="primary" disabled={busy || refreshing} onClick={() => void install(item.pair)}>{(installingPair || progress?.pair) === item.pair && busy ? t("Загрузка…") : t("Скачать")}</button>}</td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <p className="meta">{status ? t("Модели не найдены") : t("Проверка компонентов…")}</p>}
    </div>
    {busy && <div role="status">
      <p>{cancelling ? t("Отмена загрузки…") : progress?.phase === "extracting" ? t("Распаковка модели…") : t("Загрузка моделей…")} {progress?.file}</p>
      <progress aria-label={t("Загрузка моделей")} max={progress?.total || 1} value={progress?.total ? progress.downloaded ?? 0 : undefined} />
      <p>{megabytes(progress?.downloaded ?? 0)}{progress?.total ? ` / ${megabytes(progress.total)}` : ""}</p>
      <p className="meta">{t("Можно выйти из настроек — загрузка продолжится в фоне.")}</p>
      <button type="button" disabled={cancelling} onClick={() => void cancel()}>{t("Отменить загрузку")}</button>
    </div>}
    {!busy && progress?.phase === "cancelled" && <p role="status">{t("Загрузка отменена. Готовые файлы сохранены, можно повторить загрузку.")}</p>}
    <div className="model-ocr">
      <h4>{t("Распознавание сканов")}</h4>
      <p>{t("PaddleOCR · английский")}: {status?.ocrReady ? t("готово") : t("нужна загрузка")}</p>
      {!status?.ocrReady && <button type="button" disabled={busy || !status} onClick={() => void install("ocr")}>{t("Скачать OCR")}</button>}
      <p className="meta">{t("Другие языки переводятся из текстового слоя PDF. Распознавание сканов пока рассчитано на английский.")}</p>
    </div>
    {statusError && <p className="error" role="alert">{statusError}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!busy && progress?.phase === "error" && !error && <p className="error">{t(progress.message ?? "Не удалось загрузить модели")}</p>}
    <small>{t("Тексты книг не отправляются в сеть. Интернет используется для получения каталога и загрузки выбранных моделей.")}</small>
  </section>;
}

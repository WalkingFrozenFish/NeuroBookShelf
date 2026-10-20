import { t } from "./i18n";
import { useState, useSyncExternalStore } from "react";
import { isPendingJob, translationQueue } from "./translationQueue";

export function TranslationQueuePanel() {
  const jobs = useSyncExternalStore(translationQueue.subscribe, translationQueue.getSnapshot);
  const [open, setOpen] = useState(true);
  if (!jobs.length) return null;
  const pending = jobs.filter(isPendingJob).length;
  const completed = jobs.length - pending;
  return <aside className="translation-queue" aria-label={t("Очередь перевода")}>
    <div className="queue-heading">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{t("Переводы ·")}{" "}{pending ? t("осталось {0}", [pending]) : t("завершены")} {open ? "▾" : "▴"}</button>
      {pending > 0 && <button type="button" onClick={() => translationQueue.cancelAll()}>{t("Отменить все")}</button>}
      <button type="button" onClick={() => translationQueue.clearFinished()}>{t("Убрать завершённые")}</button>
    </div>
    {open && <div className="queue-overall"><span>{t("Обработано задач:")}{" "}{completed} / {jobs.length}</span><progress aria-label={t("Общий прогресс очереди")} max={jobs.length} value={completed} /></div>}
    {open && <div className="queue-jobs">{jobs.map((job) => <article key={job.id} className="queue-job">
      <strong>{job.title} {t("· стр.")}{" "}{job.pageNumber}</strong>
      {job.settings && <small>{job.settings.sourceLanguage === "auto" ? t("Автоопределение") : job.settings.sourceLanguage} → {job.settings.targetLanguage}</small>}
      {!!job.usedModels?.length && <small>{t("Модели:")} {job.usedModels.join(", ")}</small>}
      <p role="status">{t(job.phase)}</p>
      {isPendingJob(job) && <progress aria-label={t("Прогресс страницы {0}", [job.pageNumber])} max={job.total || 1} value={job.total ? job.processed : undefined} />}
      <small>{t("Сохранено:")}{" "}{job.saved} {t("· Уже переведено:")}{" "}{job.skipped} {t("· Ошибок:")}{" "}{job.failures.length}</small>
      <div className="actions">
        {isPendingJob(job) ? <button type="button" disabled={job.status === "cancelling"} onClick={() => translationQueue.cancel(job.id)}>{t("Отменить")}</button> :
          (job.status === "error" || job.status === "cancelled") && <button type="button" onClick={() => translationQueue.retry(job.id)}>{t("Продолжить / повторить ошибки")}</button>}
      </div>
      {job.failures.length > 0 && <details><summary>{t("Подробности ошибок")}</summary><ul>{job.failures.map((failure, i) => <li key={i}>{failure.block?.text.slice(0, 100)} {t(failure.message)}</li>)}</ul></details>}
    </article>)}</div>}
    {open && <small className="queue-hint">{t("Можно продолжать читать. Очередь работает, пока приложение открыто. Отмена ждёт завершения текущего вызова модели.")}</small>}
  </aside>;
}

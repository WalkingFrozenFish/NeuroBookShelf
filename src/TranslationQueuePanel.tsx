import { useState, useSyncExternalStore } from "react";
import { isPendingJob, translationQueue } from "./translationQueue";

export function TranslationQueuePanel() {
  const jobs = useSyncExternalStore(translationQueue.subscribe, translationQueue.getSnapshot);
  const [open, setOpen] = useState(true);
  if (!jobs.length) return null;
  const pending = jobs.filter(isPendingJob).length;
  const completed = jobs.length - pending;
  return <aside className="translation-queue" aria-label="Очередь перевода">
    <div className="queue-heading">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Переводы · {pending ? `осталось ${pending}` : "завершены"} {open ? "▾" : "▴"}</button>
      {pending > 0 && <button type="button" onClick={() => translationQueue.cancelAll()}>Отменить все</button>}
      <button type="button" onClick={() => translationQueue.clearFinished()}>Убрать завершённые</button>
    </div>
    {open && <div className="queue-overall"><span>Обработано задач: {completed} / {jobs.length}</span><progress aria-label="Общий прогресс очереди" max={jobs.length} value={completed} /></div>}
    {open && <div className="queue-jobs">{jobs.map((job) => <article key={job.id} className="queue-job">
      <strong>{job.title} · стр. {job.pageNumber}</strong>
      <p role="status">{job.phase}</p>
      {isPendingJob(job) && <progress aria-label={`Прогресс страницы ${job.pageNumber}`} max={job.total || 1} value={job.total ? job.processed : undefined} />}
      <small>Сохранено: {job.saved} · Уже переведено: {job.skipped} · Ошибок: {job.failures.length}</small>
      <div className="actions">
        {isPendingJob(job) ? <button type="button" disabled={job.status === "cancelling"} onClick={() => translationQueue.cancel(job.id)}>Отменить</button> :
          (job.status === "error" || job.status === "cancelled") && <button type="button" onClick={() => translationQueue.retry(job.id)}>Продолжить / повторить ошибки</button>}
      </div>
      {job.failures.length > 0 && <details><summary>Подробности ошибок</summary><ul>{job.failures.map((failure, i) => <li key={i}>{failure.block?.text.slice(0, 100)} {failure.message}</li>)}</ul></details>}
    </article>)}</div>}
    {open && <small className="queue-hint">Можно продолжать читать. Очередь работает, пока приложение открыто. Отмена ждёт завершения текущего вызова модели.</small>}
  </aside>;
}

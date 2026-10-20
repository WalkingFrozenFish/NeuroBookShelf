import * as api from "./libraryApi";
import type { TextBlock, TranslationBlockRecord, WorkerResponse, TranslationSettings } from "./libraryApi";

export type TranslationJob = {
  id: number; documentId: number; title: string; pageNumber: number;
  status: "queued" | "running" | "cancelling" | "cancelled" | "done" | "error";
  phase: string; total: number; processed: number; saved: number; skipped: number;
  failures: { block?: TextBlock; message: string }[];
  settings?: TranslationSettings;
  usedModels?: string[];
};
type QueueApi = Pick<typeof api, "listTranslationBlocks" | "analyzeDocumentPage" | "ocrDocumentPage" | "translateText" | "createTranslationBlock"> & Partial<Pick<typeof api, "getTranslationSettings">>;
export const isPendingJob = (job: TranslationJob) => ["queued", "running", "cancelling"].includes(job.status);

// Application-session queue independent of reader mounts. Serial requests share
// the existing Python model instance; no extra process or model is needed.
export class TranslationQueue {
  private jobs: TranslationJob[] = [];
  private listeners = new Set<() => void>();
  private active = false;
  private nextId = 1;
  private revision = 0;
  private preferences = new Map<number, Promise<TranslationSettings>>();
  constructor(private api: QueueApi) {}
  getSnapshot = () => this.jobs;
  getRevision = () => this.revision;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish() {
    this.jobs = [...this.jobs];
    this.listeners.forEach((listener) => listener());
  }
  enqueue(documentId: number, title: string, first: number, last: number, settings?: TranslationSettings) {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) return;
    // Capture preferences immediately, before other jobs or later UI changes.
    const captured = settings ? Promise.resolve({ ...settings }) : this.api.getTranslationSettings?.() ?? Promise.resolve({ sourceLanguage: "auto", targetLanguage: "ru" });
    // Keep a failed capture attached to the job instead of producing an unhandled rejection.
    const preference = captured.then(value => ({ value }), error => ({ error }));
    for (let pageNumber = first; pageNumber <= last; pageNumber++) {
      if (this.jobs.some((job) => job.documentId === documentId && job.pageNumber === pageNumber && isPendingJob(job))) continue;
      const id = this.nextId++;
      this.preferences.set(id, preference.then(result => { if ("error" in result) throw result.error; return result.value; }));
      this.preferences.get(id)!.catch(() => undefined);
      this.jobs.push({ id, documentId, title, pageNumber, status: "queued", phase: "В очереди", total: 0, processed: 0, saved: 0, skipped: 0, failures: [] });
    }
    this.publish();
    void this.drain();
  }
  cancel(id: number) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || !isPendingJob(job)) return;
    job.status = job.status === "queued" ? "cancelled" : "cancelling";
    job.phase = job.status === "cancelling" ? "Отмена после текущей операции…" : "Отменено";
    this.publish();
  }
  cancelAll() { this.jobs.filter(isPendingJob).forEach((job) => this.cancel(job.id)); }
  clearFinished() { this.jobs.filter(job => !isPendingJob(job)).forEach(job => this.preferences.delete(job.id)); this.jobs = this.jobs.filter(isPendingJob); this.publish(); }
  retry(id: number) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || isPendingJob(job)) return;
    this.enqueue(job.documentId, job.title, job.pageNumber, job.pageNumber, job.settings);
  }
  private patch(job: TranslationJob, phase: string) { job.phase = phase; this.publish(); }
  private cancelled(job: TranslationJob) { return job.status === "cancelling"; }
  private async drain() {
    if (this.active) return;
    this.active = true;
    try {
      let job: TranslationJob | undefined;
      while ((job = this.jobs.find((item) => item.status === "queued"))) {
        job.status = "running";
        try {
          await this.run(job);
          job.status = this.cancelled(job) ? "cancelled" : job.failures.length ? "error" : "done";
        } catch (error) {
          if (this.cancelled(job)) job.status = "cancelled";
          else { job.failures.push({ message: api.errorText(error) }); job.status = "error"; }
        }
        job.phase = job.status === "cancelled" ? "Отменено" : job.status === "error" ? "Завершено с ошибками" : "Готово";
        this.publish();
      }
    } finally { this.active = false; }
  }
  private async run(job: TranslationJob) {
    job.settings = await this.preferences.get(job.id)!;
    if (this.cancelled(job)) return;
    this.patch(job, "Анализ страницы…");
    const existing = await this.api.listTranslationBlocks(job.documentId, job.pageNumber);
    if (this.cancelled(job)) return;
    const analyzed = result(await this.api.analyzeDocumentPage(job.documentId, job.pageNumber));
    if (this.cancelled(job)) return;
    let sources = sourceBlocks(analyzed);
    if (!sources.length) {
      this.patch(job, "Распознавание страницы…");
      sources = sourceBlocks(result(await this.api.ocrDocumentPage(job.documentId, job.pageNumber)));
      if (this.cancelled(job)) return;
    }
    if (!sources.length) throw new Error("Текст на странице не найден.");
    const fresh = sources.filter((block) => !existing.some((saved) => sameArea(block, saved)));
    job.skipped = sources.length - fresh.length;
    job.total = fresh.length;
    for (const block of fresh) {
      if (this.cancelled(job)) return;
      this.patch(job, `Перевод блока ${job.processed + 1} из ${job.total}`);
      try {
        const translated = result(await this.api.translateText(block.text, job.settings.sourceLanguage, job.settings.targetLanguage));
        if (this.cancelled(job)) return;
        if (Array.isArray(translated.usedModels)) job.usedModels = [...new Set([...(job.usedModels ?? []), ...translated.usedModels.filter((pair): pair is string => typeof pair === "string")])];
        if (translated.alreadyTarget === true) { job.skipped++; job.processed++; this.publish(); continue; }
        if (typeof translated.translatedText !== "string" || !translated.translatedText.trim()) throw new Error("Получен пустой перевод");
        this.patch(job, "Сохранение…");
        await this.api.createTranslationBlock(job.documentId, job.pageNumber, block, block.text, translated.translatedText.trim(), typeof translated.translator === "string" ? translated.translator : "ctranslate2:en-ru");
        job.saved++;
        this.revision++;
      } catch (error) {
        if (this.cancelled(job)) return;
        job.failures.push({ block, message: api.errorText(error) });
      }
      job.processed++;
      this.publish();
    }
  }
}
function result(response: WorkerResponse): Record<string, unknown> {
  if (!response.success) throw new Error(`${response.error?.code ?? "WORKER_ERROR"}: ${response.error?.message ?? "Ошибка обработки"}`);
  if (!response.result || typeof response.result !== "object") throw new Error("Некорректный ответ обработчика");
  return response.result as Record<string, unknown>;
}
function sourceBlocks(value: Record<string, unknown>): TextBlock[] {
  if (!Array.isArray(value.blocks)) return [];
  return value.blocks.filter((block): block is TextBlock => block && typeof block.text === "string" && block.text.trim() &&
    [block.x, block.y, block.width, block.height].every(Number.isFinite) && block.x >= 0 && block.y >= 0 && block.width > 0 && block.height > 0 && block.x + block.width <= 1.001 && block.y + block.height <= 1.001);
}
function sameArea(block: TextBlock, saved: TranslationBlockRecord) {
  const width = Math.min(block.x + block.width, saved.sourceX + saved.sourceWidth) - Math.max(block.x, saved.sourceX);
  const height = Math.min(block.y + block.height, saved.sourceY + saved.sourceHeight) - Math.max(block.y, saved.sourceY);
  if (width <= 0 || height <= 0) return false;
  const intersection = width * height;
  const union = block.width * block.height + saved.sourceWidth * saved.sourceHeight - intersection;
  return union > 0 && intersection / union >= 0.55;
}
export const translationQueue = new TranslationQueue(api);

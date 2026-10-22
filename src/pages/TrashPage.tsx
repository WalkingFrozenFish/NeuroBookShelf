import { locale, t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { AnnotationMode, type RenderTask } from "pdfjs-dist";
import { Icon } from "../icons";
import { EmptyState } from "../EmptyState";
import {
  DocumentRecord,
  errorText,
  listShelves,
  listTags,
  listTrash,
  NamedRecord,
  purgeDocument,
  readDocumentPdf,
  restoreDocument,
} from "../libraryApi";
import { openPdf } from "../pdfSetup";

export function TrashPage({ onLibraryChanged }: { onLibraryChanged?: () => Promise<void> }) {
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [shelves, setShelves] = useState<NamedRecord[]>([]);
  const [tags, setTags] = useState<NamedRecord[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<{ action: "restore" | "purge"; ids: number[] } | null>(null);

  async function reload() {
    const [trashed, shelfList, tagList] = await Promise.all([
      listTrash(),
      listShelves(),
      listTags(),
    ]);
    setDocuments(trashed);
    setShelves(shelfList);
    setTags(tagList);
  }

  useEffect(() => {
    let active = true;
    Promise.all([listTrash(), listShelves(), listTags()])
      .then(([trashed, shelfList, tagList]) => {
        if (active) {
          setDocuments(trashed);
          setShelves(shelfList);
          setTags(tagList);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorText(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!documents) {
      return;
    }
    const alive = new Set(documents.map((document) => document.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => alive.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [documents]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setPending(true);
    setError("");
    try {
      await action();
      await reload();
      await onLibraryChanged?.();
      return true;
    } catch (actionError: unknown) {
      setError(errorText(actionError));
      try {
        await reload();
        await onLibraryChanged?.();
      } catch {
        // На экране остаётся ошибка действия.
      }
      return false;
    } finally {
      setPending(false);
    }
  }

  const visible =
    documents?.filter((document) => matchesTrash(document, shelves, tags, query)) ?? [];
  const visibleIds = visible.map((document) => document.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const id of visibleIds) {
          next.delete(id);
        }
      } else {
        for (const id of visibleIds) {
          next.add(id);
        }
      }
      return next;
    });
  }

  async function restoreSelected() {
    if (!confirm || confirm.action !== "restore" || confirm.ids.length === 0) {
      return;
    }
    const ids = confirm.ids;
    const done = await run(async () => {
      for (const id of ids) {
        await restoreDocument(id);
      }
    });
    if (done) {
      setSelected(new Set());
      setConfirm(null);
    }
  }

  async function purgeSelected() {
    if (!confirm || confirm.action !== "purge" || confirm.ids.length === 0) {
      return;
    }
    const ids = confirm.ids;
    const done = await run(async () => {
      for (const id of ids) {
        await purgeDocument(id);
      }
    });
    if (done) {
      setSelected(new Set());
      setConfirm(null);
    }
  }

  return (
    <section className="library trash-browser">
      <header className="trash-toolbar">
        <h1>{t("Корзина")}</h1>
        {documents && documents.length > 0 ? (
          <label className="library-search">
            <span className="sr-only">{t("Поиск")}</span>
            <input
              type="search"
              value={query}
              placeholder={t("Поиск")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}
      </header>
      <p className="trash-description">{t("Здесь можно восстановить книги или удалить их навсегда.")}</p>
      {error ? <p className="error">{error}</p> : null}
      {documents && documents.length > 0 && (visible.length > 0 || selected.size > 0) ? (
        <div className="trash-select-bar">
          <div className="trash-select-main">
            <label className="trash-check trash-select-all" htmlFor="trash-select-all">
              <SelectAll
                id="trash-select-all"
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && someVisibleSelected}
                disabled={pending || visible.length === 0}
                onChange={toggleVisible}
              />
              <span>{t("Выбрать все")}</span>
            </label>
            {selected.size > 0 ? <span className="trash-select-count">{t("Выбрано:")}{" "}{selected.size}</span> : null}
            {selected.size > 0 ? (
              <div className="trash-actions trash-select-actions">
                <button
                  type="button"
                  className="trash-restore"
                  aria-label={t("Восстановить")}
                  title={t("Восстановить")}
                  disabled={pending}
                  onClick={() => setConfirm({ action: "restore", ids: [...selected] })}
                >
                  <Icon name="restore" />
                  <span className="sr-only">{t("Восстановить")}</span>
                </button>
                <button
                  type="button"
                  className="trash-delete"
                  aria-label={t("Удалить")}
                  title={t("Удалить")}
                  disabled={pending}
                  onClick={() => setConfirm({ action: "purge", ids: [...selected] })}
                >
                  <Icon name="trash" />
                  <span className="sr-only">{t("Удалить")}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {documents === null ? (
        <p>{t("Загрузка корзины…")}</p>
      ) : documents.length === 0 ? (
        <EmptyState icon="trash" title={t("Удалённых документов нет.")}>{t("Книги, перемещённые в корзину, появятся здесь. Их можно будет восстановить.")}</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon="search" title={t("Ничего не найдено.")}
          action={<button type="button" onClick={() => setQuery("")}>{t("Сбросить фильтры")}</button>}>
          {t("Попробуйте другой запрос или сбросьте фильтры.")}
        </EmptyState>
      ) : (
        <ul className="trash-list">
          {visible.map((document) => (
            <TrashCard
              key={document.id}
              document={document}
              shelves={shelves}
              tags={tags}
              pending={pending}
              selected={selected.has(document.id)}
              onToggle={() => toggle(document.id)}
              onRestore={() => setConfirm({ action: "restore", ids: [document.id] })}
              onPurge={() => setConfirm({ action: "purge", ids: [document.id] })}
            />
          ))}
        </ul>
      )}
      {confirm && documents ? (
        <TrashConfirm
          action={confirm.action}
          titles={confirm.ids.map((id) => documents.find((item) => item.id === id)?.title ?? t("книгу"))}
          pending={pending}
          onClose={() => {
            if (!pending) {
              setConfirm(null);
            }
          }}
          onConfirm={() => (confirm.action === "restore" ? restoreSelected() : purgeSelected())}
        />
      ) : null}
    </section>
  );
}

function TrashConfirm({
  action,
  titles,
  pending,
  onClose,
  onConfirm,
}: {
  action: "restore" | "purge";
  titles: string[];
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const many = titles.length > 1;
  const name = titles[0] ?? t("книгу");
  const copy =
    action === "restore"
      ? {
          title: t("Восстановить"),
          text: many
            ? t("Выбранные книги ({0}) снова появятся в библиотеке.", [titles.length])
            : t("«{0}» снова появится в библиотеке.", [name]),
          question: many ? t("Точно восстановить выбранные книги?") : t("Точно восстановить эту книгу?"),
          confirm: t("Да, восстановить"),
        }
      : {
          title: t("Удалить навсегда"),
          text: many
            ? t("Файлы PDF будут удалены с диска, а записи исчезнут из базы. Это нельзя отменить.")
            : t("Файл PDF «{0}» будет удалён с диска, а запись исчезнет из базы. Это нельзя отменить.", [name]),
          question: many ? t("Точно удалить выбранные книги ({0})?", [titles.length]) : t("Точно удалить эту книгу?"),
          confirm: t("Да, удалить"),
        };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trash-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="trash-confirm-title">{copy.title}</h2>
        <p>{copy.text}</p>
        <p>{copy.question}</p>
        <div className="actions">
          <button type="button" autoFocus disabled={pending} onClick={onClose}>
            {t("Нет, оставить")}</button>
          <button
            type="button"
            className={action === "purge" ? "danger" : "primary"}
            disabled={pending}
            onClick={onConfirm}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectAll({
  id,
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function TrashCard({
  document,
  shelves,
  tags,
  pending,
  selected,
  onToggle,
  onRestore,
  onPurge,
}: {
  document: DocumentRecord;
  shelves: NamedRecord[];
  tags: NamedRecord[];
  pending: boolean;
  selected: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const [author, setAuthor] = useState<string | null | undefined>(document.path ? undefined : null);

  return (
    <li className={selected ? "trash-card selected" : "trash-card"} data-trash-id={document.id}>
      <div className="trash-cover">
        <label className="trash-check trash-cover-check">
          <input
            type="checkbox"
            checked={selected}
            disabled={pending}
            aria-label={t("Выбрать «{0}»", [document.title])}
            onChange={onToggle}
          />
        </label>
        {document.path ? (
          <TrashCover documentId={document.id} onAuthor={setAuthor} />
        ) : (
          <span className="cover-fallback">{t("Нет PDF")}</span>
        )}
      </div>
      <div className="trash-body">
        <div className="trash-copy">
          <div className="trash-heading">
            <div className="trash-heading-copy">
              <strong className="trash-title" title={document.title}>
                {document.title}
              </strong>
              <div className="trash-author">
                {author === undefined ? t("Автор…") : author ?? t("Автор не указан")}
              </div>
            </div>
          </div>
          <ChipRow label={t("Теги")} items={tags} ids={document.tagIds} colorful />
          <ChipRow label={t("Полки")} items={shelves} ids={document.shelfIds} colorful={false} />
          <dl className="trash-facts">
            <div>
              <dt>{t("Вес")}</dt>
              <dd>{formatSize(document.fileSize)}</dd>
            </div>
            <div>
              <dt>{t("Удалён")}</dt>
              <dd>{formatDeleted(document.deletedAt)}</dd>
            </div>
            <div>
              <dt>{t("Файл")}</dt>
              <dd title={document.originalFilename ?? undefined}>
                {document.originalFilename ?? t("Без файла")}
              </dd>
            </div>
          </dl>
        </div>
        <div className="trash-actions">
          <button
            type="button"
            className="trash-restore"
            aria-label={t("Восстановить")}
            title={t("Восстановить")}
            disabled={pending}
            onClick={onRestore}
          >
            <Icon name="restore" />
            <span className="sr-only">{t("Восстановить")}</span>
          </button>
          <button
            type="button"
            className="trash-delete"
            aria-label={t("Удалить")}
            title={t("Удалить")}
            disabled={pending}
            onClick={onPurge}
          >
            <Icon name="trash" />
            <span className="sr-only">{t("Удалить")}</span>
          </button>
        </div>
      </div>
    </li>
  );
}

function matchesTrash(
  document: DocumentRecord,
  shelves: NamedRecord[],
  tags: NamedRecord[],
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    document.title,
    document.originalFilename ?? "",
    namesFor(shelves, document.shelfIds),
    namesFor(tags, document.tagIds),
    formatDeleted(document.deletedAt),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

function namesFor(items: NamedRecord[], ids: number[]): string {
  return ids
    .map((id) => items.find((item) => item.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(" ");
}

function ChipRow({
  label,
  items,
  ids,
  colorful,
}: {
  label: string;
  items: NamedRecord[];
  ids: number[];
  colorful: boolean;
}) {
  const linked = ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is NamedRecord => Boolean(item));

  return (
    <div className="trash-group">
      <span className="trash-kicker">{label}</span>
      <div className="trash-chips">
        {linked.length === 0 ? <span className="trash-empty">{t("нет")}</span> : null}
        {linked.map((item) =>
          colorful ? (
            <span key={item.id} className={`tag-chip tone-${item.id % 6}`}>
              <span className="tag-fade-label">{item.name}</span>
            </span>
          ) : (
            <span key={item.id} className="trash-shelf">
              {item.name}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function TrashCover({
  documentId,
  onAuthor,
}: {
  documentId: number;
  onAuthor: (author: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onAuthorRef = useRef(onAuthor);
  const [failed, setFailed] = useState(false);
  onAuthorRef.current = onAuthor;

  useEffect(() => {
    const state = { cancelled: false, task: null as RenderTask | null };
    let loading: ReturnType<typeof openPdf> | null = null;

    async function draw() {
      let authorReady = false;
      try {
        const payload = await readDocumentPdf(documentId);
        if (state.cancelled) {
          return;
        }
        loading = openPdf(toBytes(payload));
        const pdf = await loading.promise;
        if (state.cancelled) {
          await pdf.destroy();
          return;
        }
        const meta = await pdf.getMetadata();
        if (!state.cancelled) {
          onAuthorRef.current(readAuthor(meta));
          authorReady = true;
        }
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || state.cancelled) {
          page.cleanup();
          await pdf.destroy();
          return;
        }
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: (128 * Math.min(window.devicePixelRatio || 1, 2)) / base.width,
        });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        state.task = page.render({
          canvas,
          viewport,
          annotationMode: AnnotationMode.DISABLE,
        });
        await state.task.promise;
        page.cleanup();
        await pdf.destroy();
      } catch {
        if (!state.cancelled) {
          if (!authorReady) {
            onAuthorRef.current(null);
          }
          setFailed(true);
        }
      }
    }

    void draw();
    return () => {
      state.cancelled = true;
      state.task?.cancel();
      void loading?.destroy();
    };
  }, [documentId]);

  if (failed) {
    return <span className="cover-fallback">PDF</span>;
  }
  return <canvas ref={canvasRef} />;
}

function readAuthor(meta: { info: object; metadata: { get(name: string): string | null } | null }): string | null {
  const info = meta.info as { Author?: unknown };
  return cleanAuthor(info.Author) ?? cleanAuthor(meta.metadata?.get("dc:creator"));
}

function cleanAuthor(value: unknown): string | null {
  const raw = Array.isArray(value) ? value.join(", ") : value;
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function toBytes(payload: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload);
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  return Uint8Array.from(payload);
}

function formatSize(size: number | null): string {
  if (size === null) {
    return t("неизвестен");
  }
  const megabytes = size / (1024 * 1024);
  if (megabytes > 0 && megabytes < 0.01) {
    return t("< 0,01 МБ");
  }
  const digits = megabytes >= 10 ? 1 : 2;
  return t("{0} МБ", [megabytes.toLocaleString(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })]);
}

function formatDeleted(value: string | null): string {
  if (!value) {
    return t("неизвестно");
  }
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(locale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

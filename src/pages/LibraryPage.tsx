import { DragEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { AnnotationMode, getDocument, type RenderTask } from "pdfjs-dist";
import { confirmAction } from "../confirm";
import { Icon } from "../icons";
import { themes } from "../theme";
import "../pdfSetup";
import {
  createShelf,
  createTag,
  clearLibrary,
  databasePath,
  deleteShelf,
  deleteTag,
  DocumentRecord,
  errorText,
  exportPdf,
  importPdf,
  listDocuments,
  listShelves,
  listTags,
  relocateDatabase,
  resetShelves,
  resetTags,
  NamedRecord,
  readDocumentPdf,
  trashDocument,
  updateDocument,
  updateShelf,
  updateTag,
} from "../libraryApi";

type LibraryData = {
  path: string;
  documents: DocumentRecord[];
  shelves: NamedRecord[];
  tags: NamedRecord[];
};

export function LibraryPage({
  onOpen,
  theme,
  onTheme,
}: {
  onOpen: (id: number) => void;
  theme: string;
  onTheme: (theme: string) => Promise<void>;
}) {
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [openShelf, setOpenShelf] = useState<ShelfView>("all");

  async function reload() {
    const [path, documents, shelves, tags] = await Promise.all([
      databasePath(),
      listDocuments(),
      listShelves(),
      listTags(),
    ]);
    setData({ path, documents, shelves, tags });
  }

  useEffect(() => {
    let active = true;
    Promise.all([databasePath(), listDocuments(), listShelves(), listTags()])
      .then(([path, documents, shelves, tags]) => {
        if (active) {
          setData({ path, documents, shelves, tags });
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

  async function run(action: () => Promise<void>): Promise<boolean> {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
      await reload();
      return true;
    } catch (actionError: unknown) {
      setError(errorText(actionError));
      return false;
    } finally {
      setPending(false);
    }
  }

  if (!data) {
    return (
      <section>
        <h1>NeuroBookShelf</h1>
        {error ? <p className="error">{error}</p> : <p>Загрузка библиотеки…</p>}
      </section>
    );
  }

  function saveLinks(document: DocumentRecord, shelfIds: number[], tagIds: number[]) {
    return run(() =>
      updateDocument(document.id, document.title, shelfIds, tagIds).then(() => undefined),
    );
  }

  function addToShelf(documentId: number, shelfId: number) {
    const document = data?.documents.find((item) => item.id === documentId);
    if (!document || document.shelfIds.includes(shelfId)) {
      return Promise.resolve(false);
    }
    return saveLinks(document, [...document.shelfIds, shelfId], document.tagIds);
  }

  const shelfStillExists =
    openShelf === "all" || openShelf === "loose" || data.shelves.some((shelf) => shelf.id === openShelf);
  const activeShelf = shelfStillExists ? openShelf : "all";

  return (
    <section className="library library-browser">
      <DocumentsSection
        openShelf={activeShelf}
        onOpenShelf={setOpenShelf}
        documents={data.documents}
        shelves={data.shelves}
        tags={data.tags}
        pending={pending}
        onOpen={onOpen}
        onUpdate={(id, title, shelfIds, tagIds) =>
          run(() => updateDocument(id, title, shelfIds, tagIds).then(() => undefined))
        }
        onTrash={(id) => run(() => trashDocument(id))}
        onExport={(id) =>
          run(async () => {
            const exported = await exportPdf(id);
            if (exported) {
              setNotice(`PDF экспортирован в ${exported}`);
            }
          })
        }
        onImport={() => run(() => importPdf().then(() => undefined))}
        onAddToShelf={addToShelf}
        onCreateShelf={(name) => run(() => createShelf(name).then(() => undefined))}
        onUpdateShelf={(id, name) => run(() => updateShelf(id, name).then(() => undefined))}
        onDeleteShelf={async (id, name) => {
          if (await confirmAction(`Удалить полку «${name}»? Книги останутся в библиотеке.`)) {
            if (openShelf === id) {
              setOpenShelf("all");
            }
            return run(() => deleteShelf(id));
          }
          return Promise.resolve(false);
        }}
        onCreateTag={(name) => run(() => createTag(name).then(() => undefined))}
        onUpdateTag={(id, name) => run(() => updateTag(id, name).then(() => undefined))}
        onDeleteTag={async (id, name) => {
          if (await confirmAction(`Удалить тег «${name}»? Связи с документами будут сняты.`)) {
            return run(() => deleteTag(id));
          }
          return Promise.resolve(false);
        }}
        databasePath={data.path}
        theme={theme}
        onTheme={async (next) => {
          setError("");
          try {
            await onTheme(next);
          } catch (themeError: unknown) {
            setError(errorText(themeError));
          }
        }}
        onRelocate={() =>
          run(async () => {
            const path = await relocateDatabase();
            if (path) {
              setNotice(`База скопирована в ${path}`);
            }
          })
        }
        onResetShelves={() => run(() => resetShelves())}
        onResetTags={() => run(() => resetTags())}
        onClearLibrary={() => run(() => clearLibrary())}
        error={error}
        notice={notice}
      />
    </section>
  );
}

type ShelfView = "all" | "loose" | number;

const SHELF_MIN = 260;
const SHELF_MAX = SHELF_MIN + 120;
const NAME_LIMIT = 30;

function DocumentsSection({
  documents,
  shelves,
  tags,
  pending,
  openShelf,
  onOpenShelf,
  onOpen,
  onUpdate,
  onTrash,
  onExport,
  onImport,
  onAddToShelf,
  onCreateShelf,
  onUpdateShelf,
  onDeleteShelf,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  databasePath,
  theme,
  onTheme,
  onRelocate,
  onResetShelves,
  onResetTags,
  onClearLibrary,
  error,
  notice,
}: {
  documents: DocumentRecord[];
  shelves: NamedRecord[];
  tags: NamedRecord[];
  pending: boolean;
  openShelf: ShelfView;
  onOpenShelf: (shelf: ShelfView) => void;
  onOpen: (id: number) => void;
  onUpdate: (
    id: number,
    title: string,
    shelfIds: number[],
    tagIds: number[],
  ) => Promise<boolean>;
  onTrash: (id: number) => Promise<boolean>;
  onExport: (id: number) => Promise<boolean>;
  onImport: () => Promise<boolean>;
  onAddToShelf: (documentId: number, shelfId: number) => Promise<boolean>;
  onCreateShelf: (name: string) => Promise<boolean>;
  onUpdateShelf: (id: number, name: string) => Promise<boolean>;
  onDeleteShelf: (id: number, name: string) => Promise<boolean>;
  onCreateTag: (name: string) => Promise<boolean>;
  onUpdateTag: (id: number, name: string) => Promise<boolean>;
  onDeleteTag: (id: number, name: string) => Promise<boolean>;
  databasePath: string;
  theme: string;
  onTheme: (theme: string) => Promise<void>;
  onRelocate: () => Promise<boolean>;
  onResetShelves: () => Promise<boolean>;
  onResetTags: () => Promise<boolean>;
  onClearLibrary: () => Promise<boolean>;
  error: string;
  notice: string;
}) {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [settingsId, setSettingsId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shelvesOpen, setShelvesOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [dialog, setDialog] = useState<ListDialog | null>(null);
  const [confirmKind, setConfirmKind] = useState<null | "shelves" | "tags" | "library">(null);
  const [shelfWidth, setShelfWidth] = useState(SHELF_MIN);

  useEffect(() => {
    if (tagFilter !== null && !tags.some((tag) => tag.id === tagFilter)) {
      setTagFilter(null);
    }
  }, [tags, tagFilter]);

  const visible = documents.filter((document) => matchesShelf(document, openShelf, query, tagFilter));
  const shelfName =
    openShelf === "all" ? "Все книги" : openShelf === "loose" ? "Без полки" : shelves.find((shelf) => shelf.id === openShelf)?.name ?? "Полка";
  const settingsBook = settingsId === null ? null : documents.find((document) => document.id === settingsId) ?? null;

  function chooseShelf(shelf: ShelfView) {
    setSettingsOpen(false);
    onOpenShelf(shelf);
  }

  function onShelfResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = shelfWidth;
    const move = (pointerEvent: PointerEvent) => {
      const next = Math.round(Math.min(SHELF_MAX, Math.max(SHELF_MIN, startWidth + (pointerEvent.clientX - startX))));
      setShelfWidth(next);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен или захват недоступен.
    }
  }

  return (
    <>
      <header className="library-toolbar">
        <div className="library-title">
          <h1>NeuroBookShelf</h1>
          <span className="path-pin" aria-hidden="true">
            <Icon name="path" />
          </span>
          <p className="path-pop">{databasePath}</p>
        </div>
        <label className="library-search">
          <span className="sr-only">Поиск</span>
          <input
            type="search"
            value={query}
            placeholder="Поиск"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" className="primary" disabled={pending} onClick={() => void onImport()}>
          <Icon name="import" />
          Импорт PDF
        </button>
      </header>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      <div
        className="library-workspace"
        style={{ "--shelf-column": `${shelfWidth}px` } as React.CSSProperties}
      >
        <aside className="shelf-column" aria-label="Полки">
          <div className="shelf-frame">
          <div className="shelf-scroll">
          <ul className="mini-list">
            <li>
              <button
                type="button"
                className={!settingsOpen && openShelf === "all" ? "mini-row active" : "mini-row"}
                onClick={() => chooseShelf("all")}
              >
                <span>Все книги</span>
                <span className="count">{documents.length}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className={!settingsOpen && openShelf === "loose" ? "mini-row active" : "mini-row"}
                onClick={() => chooseShelf("loose")}
              >
                <span>Без полки</span>
                <span className="count">{documents.filter((document) => document.shelfIds.length === 0).length}</span>
              </button>
            </li>
          </ul>
          <div className="list-heading">
            <button
              type="button"
              className={shelvesOpen ? "list-toggle open" : "list-toggle"}
              aria-expanded={shelvesOpen}
              onClick={() => setShelvesOpen((open) => !open)}
            >
              <Icon name="down" />
              Полки
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Новая полка"
              disabled={pending}
              onClick={() => setDialog({ kind: "create-shelf" })}
            >
              +
            </button>
          </div>
          {shelvesOpen ? (
            <>
              {shelves.length === 0 ? <p className="meta">Полок пока нет.</p> : null}
              <ul className="mini-list">
                {shelves.map((shelf) => (
                  <li key={shelf.id}>
                    <ShelfDrop
                      pending={pending}
                      label={shelf.name}
                      onDrop={(documentId) => onAddToShelf(documentId, shelf.id)}
                    >
                      <div className={!settingsOpen && openShelf === shelf.id ? "shelf-line active" : "shelf-line"}>
                        <button
                          type="button"
                          className="mini-row with-count"
                          onClick={() => chooseShelf(shelf.id)}
                        >
                          <span>{shelf.name}</span>
                          <span className="count">
                            {documents.filter((document) => document.shelfIds.includes(shelf.id)).length}
                          </span>
                        </button>
                        {openShelf === shelf.id && !settingsOpen ? (
                          <button
                            type="button"
                            className="icon-button shelf-more"
                            aria-label={`Действия: ${shelf.name}`}
                            disabled={pending}
                            onClick={() => setDialog({ kind: "shelf", id: shelf.id, name: shelf.name })}
                          >
                            ⋮
                          </button>
                        ) : null}
                      </div>
                    </ShelfDrop>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="list-heading">
            <button
              type="button"
              className={tagsOpen ? "list-toggle open" : "list-toggle"}
              aria-expanded={tagsOpen}
              onClick={() => setTagsOpen((open) => !open)}
            >
              <Icon name="down" />
              Теги
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Новый тег"
              disabled={pending}
              onClick={() => setDialog({ kind: "create-tag" })}
            >
              +
            </button>
          </div>
          {tagsOpen ? (
            <>
              {tags.length === 0 ? <p className="meta">Тегов пока нет.</p> : null}
              <div className="tag-cloud">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className={`tag-chip tone-${tag.id % 6}${tagFilter === tag.id ? " active" : ""}`}
                  >
                    <button
                      type="button"
                      className="tag-main"
                      aria-pressed={tagFilter === tag.id}
                      onClick={() => setTagFilter((current) => (current === tag.id ? null : tag.id))}
                    >
                      {tag.name}
                    </button>
                    <button
                      type="button"
                      className="tag-more"
                      aria-label={`Действия: ${tag.name}`}
                      disabled={pending}
                      onClick={() => setDialog({ kind: "tag", id: tag.id, name: tag.name })}
                    >
                      ⋮
                    </button>
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {dialog ? (
            <ListDialog
              dialog={dialog}
              pending={pending}
              onClose={() => setDialog(null)}
              onCreateShelf={onCreateShelf}
              onUpdateShelf={onUpdateShelf}
              onDeleteShelf={onDeleteShelf}
              onCreateTag={onCreateTag}
              onUpdateTag={onUpdateTag}
              onDeleteTag={async (id, name) => {
                const removed = await onDeleteTag(id, name);
                if (removed && tagFilter === id) {
                  setTagFilter(null);
                }
                return removed;
              }}
            />
          ) : null}
          </div>
          <button
            type="button"
            className={settingsOpen ? "settings-entry active" : "settings-entry"}
            aria-current={settingsOpen ? "page" : undefined}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
            Настройки
          </button>
          </div>
          <div
            className="shelf-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ширина меню"
            aria-valuemin={SHELF_MIN}
            aria-valuemax={SHELF_MAX}
            aria-valuenow={shelfWidth}
            title="Потяните, чтобы изменить ширину"
            onPointerDown={onShelfResizeStart}
          >
            ⋮
          </div>
        </aside>
        <div className="book-stage">
          {settingsOpen ? (
            <>
            <section className="settings-screen">
              <h2>Настройки</h2>
              <section className="settings-block">
                <h3>База</h3>
                <p className="settings-path" title={databasePath}>
                  {databasePath}
                </p>
                <button type="button" disabled={pending} onClick={() => void onRelocate()}>
                  Сменить путь
                </button>
                <p className="meta">Файл базы копируется в выбранное место. Прежняя копия остаётся.</p>
              </section>
              <section className="settings-block">
                <h3>Тема</h3>
                <div className="theme-choices">
                  {themes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={theme === item.id ? "theme-choice active" : "theme-choice"}
                      aria-pressed={theme === item.id}
                      onClick={() => void onTheme(item.id)}
                    >
                      <span className={`theme-swatch theme-${item.id}`} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
              <section className="settings-block">
                <h3>Сброс полок</h3>
                <p className="meta">Будут удалены все полки. Книги и теги останутся.</p>
                <button type="button" disabled={pending} onClick={() => setConfirmKind("shelves")}>
                  Сбросить полки
                </button>
              </section>
              <section className="settings-block">
                <h3>Сброс тегов</h3>
                <p className="meta">Будут удалены все теги. Книги и полки останутся.</p>
                <button type="button" disabled={pending} onClick={() => setConfirmKind("tags")}>
                  Сбросить теги
                </button>
              </section>
              <section className="settings-block">
                <h3>Очистить библиотеку</h3>
                <p className="meta">
                  Книги исчезнут из библиотеки навсегда, восстановить их будет нельзя. Файлы на компьютере не удаляются.
                </p>
                <button type="button" className="danger" disabled={pending} onClick={() => setConfirmKind("library")}>
                  Очистить библиотеку
                </button>
              </section>
            </section>
            {confirmKind ? (
              <ConfirmResetDialog
                pending={pending}
                kind={confirmKind}
                onClose={() => setConfirmKind(null)}
                onConfirm={async () => {
                  const done =
                    confirmKind === "shelves"
                      ? await onResetShelves()
                      : confirmKind === "tags"
                        ? await onResetTags()
                        : await onClearLibrary();
                  if (done) {
                    setConfirmKind(null);
                  }
                }}
              />
            ) : null}
            </>
          ) : (
            <>
          <div className="section-heading">
            <h2>{shelfName}</h2>
            <p className="meta">{visible.length}</p>
          </div>
          {documents.length === 0 ? (
        <p>Документов пока нет.</p>
      ) : visible.length === 0 ? (
        <p>Ничего не найдено.</p>
      ) : (
        <ul className="book-grid">
          {visible.map((document) => (
            <li
              key={document.id}
              data-document-id={document.id}
              draggable={!pending}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", String(document.id));
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <div className="book-cover">
                {document.path ? <BookCover documentId={document.id} /> : <span className="cover-fallback">Нет PDF</span>}
                <strong className="book-name" title={document.title}>
                  {document.title}
                </strong>
              </div>
              <button
                type="button"
                className="book-menu"
                aria-label={`Настройки: ${document.title}`}
                disabled={pending}
                onClick={() => setSettingsId(document.id)}
              >
                ⋮
              </button>
              <div className="book-meta">
                <LinkPreview label="Полки" items={shelves} ids={document.shelfIds} colorful={false} />
                <LinkPreview label="Теги" items={tags} ids={document.tagIds} colorful />
              </div>
              <button
                type="button"
                className="book-read primary"
                disabled={!document.path || pending}
                onClick={() => onOpen(document.id)}
              >
                <Icon name="read" />
                Читать
              </button>
            </li>
          ))}
        </ul>
      )}
            </>
          )}
        </div>
      </div>
      {settingsBook ? (
        <BookSettings
          document={settingsBook}
          shelves={shelves}
          tags={tags}
          pending={pending}
          onClose={() => setSettingsId(null)}
          onRename={(title) => onUpdate(settingsBook.id, title, settingsBook.shelfIds, settingsBook.tagIds)}
          onSetLinks={(shelfIds, tagIds) => onUpdate(settingsBook.id, settingsBook.title, shelfIds, tagIds)}
          onExport={() => onExport(settingsBook.id)}
          onTrash={async () => {
            if (await confirmAction(`Переместить «${settingsBook.title}» в корзину? Файл не будет удалён с диска.`)) {
              return onTrash(settingsBook.id);
            }
            return Promise.resolve(false);
          }}
        />
      ) : null}
    </>
  );
}

function ConfirmResetDialog({
  pending,
  kind,
  onClose,
  onConfirm,
}: {
  pending: boolean;
  kind: "shelves" | "tags" | "library";
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const copy =
    kind === "shelves"
      ? {
          title: "Сбросить полки",
          text: "Все полки будут удалены. Книги и теги останутся.",
          question: "Точно сбросить все полки?",
          confirm: "Да, сбросить",
        }
      : kind === "tags"
        ? {
            title: "Сбросить теги",
            text: "Все теги будут удалены. Книги и полки останутся.",
            question: "Точно сбросить все теги?",
            confirm: "Да, сбросить",
          }
        : {
            title: "Очистить библиотеку",
            text: "Книги будут удалены из библиотеки навсегда, восстановить их будет нельзя. Файлы на компьютере останутся.",
            question: "Точно удалить все книги?",
            confirm: "Да, удалить",
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
    <div className="modal-backdrop" onMouseDown={() => { if (!pending) onClose(); }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-reset-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-reset-title">{copy.title}</h2>
        <p>{copy.text}</p>
        <p>{copy.question}</p>
        <div className="actions">
          <button type="button" autoFocus disabled={pending} onClick={onClose}>
            Нет, оставить
          </button>
          <button type="button" className="danger" disabled={pending} onClick={() => void onConfirm()}>
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

type ListDialog =
  | { kind: "create-shelf" }
  | { kind: "create-tag" }
  | { kind: "shelf"; id: number; name: string }
  | { kind: "tag"; id: number; name: string };

function ListDialog({
  dialog,
  pending,
  onClose,
  onCreateShelf,
  onUpdateShelf,
  onDeleteShelf,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: {
  dialog: ListDialog;
  pending: boolean;
  onClose: () => void;
  onCreateShelf: (name: string) => Promise<boolean>;
  onUpdateShelf: (id: number, name: string) => Promise<boolean>;
  onDeleteShelf: (id: number, name: string) => Promise<boolean>;
  onCreateTag: (name: string) => Promise<boolean>;
  onUpdateTag: (id: number, name: string) => Promise<boolean>;
  onDeleteTag: (id: number, name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(dialog.kind === "shelf" || dialog.kind === "tag" ? dialog.name : "");
  const creating = dialog.kind === "create-shelf" || dialog.kind === "create-tag";
  const nameLength = Array.from(name.trim()).length;
  const title =
    dialog.kind === "create-shelf"
      ? "Новая полка"
      : dialog.kind === "create-tag"
        ? "Новый тег"
        : dialog.kind === "shelf"
          ? "Полка"
          : "Тег";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved =
      dialog.kind === "create-shelf"
        ? await onCreateShelf(name)
        : dialog.kind === "create-tag"
          ? await onCreateTag(name)
          : dialog.kind === "shelf"
            ? await onUpdateShelf(dialog.id, name)
            : await onUpdateTag(dialog.id, name);
    if (saved) {
      onClose();
    }
  }

  async function remove() {
    if (dialog.kind !== "shelf" && dialog.kind !== "tag") {
      return;
    }
    const removed =
      dialog.kind === "shelf"
        ? await onDeleteShelf(dialog.id, dialog.name)
        : await onDeleteTag(dialog.id, dialog.name);
    if (removed) {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2>{title}</h2>
        {dialog.kind === "shelf" ? <p className="meta">Книги останутся в библиотеке.</p> : null}
        <label>
          Название
          <input
            value={name}
            maxLength={NAME_LIMIT}
            onChange={(event) => setName(Array.from(event.target.value).slice(0, NAME_LIMIT).join(""))}
            disabled={pending}
            autoFocus
          />
        </label>
        {nameLength > NAME_LIMIT ? <p className="meta">Не больше 30 символов.</p> : null}
        <div className="actions">
          <button type="submit" className="primary" disabled={pending || name.trim() === "" || nameLength > NAME_LIMIT}>
            {creating ? "Создать" : "Сохранить"}
          </button>
          <button type="button" disabled={pending} onClick={onClose}>
            Отмена
          </button>
          {creating ? null : (
            <button type="button" className="danger" disabled={pending} onClick={() => void remove()}>
              Удалить
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function BookCover({ documentId }: { documentId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const state = { cancelled: false, task: null as RenderTask | null };
    let loading: ReturnType<typeof getDocument> | null = null;
    async function draw() {
      try {
        const payload = await readDocumentPdf(documentId);
        if (state.cancelled) {
          return;
        }
        loading = getDocument({ data: toBytes(payload) });
        const pdf = await loading.promise;
        if (state.cancelled) {
          await pdf.destroy();
          return;
        }
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || state.cancelled) {
          page.cleanup();
          await pdf.destroy();
          return;
        }
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 148 / base.width });
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

function toBytes(payload: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload);
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  return Uint8Array.from(payload);
}

function ShelfDrop({
  pending,
  label,
  onDrop,
  children,
}: {
  pending: boolean;
  label: string;
  onDrop: (documentId: number) => Promise<boolean> | void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);

  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (pending) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
  }

  function dragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setOver(false);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    if (pending) {
      return;
    }
    const documentId = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isInteger(documentId)) {
      void onDrop(documentId);
    }
  }

  return (
    <div
      className={over ? "drop-target active" : "drop-target"}
      data-drop-shelf={label}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      {children}
    </div>
  );
}

function LinkPreview({
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
    <div className="tag-fade preview">
      <span className="link-fade-name">{label}</span>
      <div className="tag-fade-track">
        {linked.length === 0 ? <span className="meta">нет</span> : null}
        {linked.map((item) =>
          colorful ? (
            <span key={item.id} className={`tag-chip tone-${item.id % 6}`}>
              <span className="tag-fade-label">{item.name}</span>
            </span>
          ) : (
            <span key={item.id} className="link-fade-item">
              {item.name}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function BookSettings({
  document,
  shelves,
  tags,
  pending,
  onClose,
  onRename,
  onSetLinks,
  onExport,
  onTrash,
}: {
  document: DocumentRecord;
  shelves: NamedRecord[];
  tags: NamedRecord[];
  pending: boolean;
  onClose: () => void;
  onRename: (title: string) => Promise<boolean>;
  onSetLinks: (shelfIds: number[], tagIds: number[]) => Promise<boolean>;
  onExport: () => Promise<boolean>;
  onTrash: () => Promise<boolean>;
}) {
  const [title, setTitle] = useState(document.title);
  const [editingTitle, setEditingTitle] = useState(false);

  useEffect(() => {
    setTitle(document.title);
    setEditingTitle(false);
  }, [document.id, document.title]);

  function toggleId(ids: number[], id: number): number[] {
    return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
  }

  function resetTitle() {
    setTitle(document.title);
    setEditingTitle(false);
  }

  async function saveTitle() {
    if (title.trim() === "" || title.trim() === document.title) {
      return;
    }
    if (await onRename(title)) {
      setEditingTitle(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal book-settings" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="settings-close" aria-label="Закрыть" onClick={onClose}>
          <Icon name="clear" />
        </button>
        <div className="settings-line">
          <span className="settings-kicker">Название документа</span>
          <span className="settings-plain" title={document.originalFilename ?? undefined}>
            {document.originalFilename ?? "Без файла"}
            {document.originalFilename ? <span className="meta"> {formatSize(document.fileSize)}</span> : null}
          </span>
        </div>
        <div className="settings-line">
          <span className="settings-kicker">Название</span>
          {editingTitle ? (
            <div className="title-editor">
              <input
                value={title}
                disabled={pending}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    resetTitle();
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveTitle();
                  }
                }}
              />
              <button
                type="button"
                className="primary"
                disabled={pending || title.trim() === "" || title.trim() === document.title}
                onClick={() => void saveTitle()}
              >
                Сохранить
              </button>
              <button type="button" disabled={pending} onClick={resetTitle}>
                Сбросить
              </button>
            </div>
          ) : (
            <>
              <span className="settings-plain">{document.title}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Изменить название"
                disabled={pending}
                onClick={() => {
                  setTitle(document.title);
                  setEditingTitle(true);
                }}
              >
                <Icon name="edit" />
              </button>
            </>
          )}
        </div>
        <h3>Полки</h3>
        {shelves.length === 0 ? (
          <p className="meta">Полок пока нет.</p>
        ) : (
          <ChoiceSplit
            items={shelves}
            selectedIds={document.shelfIds}
            pending={pending}
            colorful={false}
            onToggle={(id) => void onSetLinks(toggleId(document.shelfIds, id), document.tagIds)}
          />
        )}
        <h3>Теги</h3>
        {tags.length === 0 ? (
          <p className="meta">Тегов пока нет.</p>
        ) : (
          <ChoiceSplit
            items={tags}
            selectedIds={document.tagIds}
            pending={pending}
            colorful
            onToggle={(id) => void onSetLinks(document.shelfIds, toggleId(document.tagIds, id))}
          />
        )}
        <div className="book-settings-actions">
          {document.path ? (
            <button type="button" disabled={pending} onClick={() => void onExport()}>
              <Icon name="export" />
              Экспорт
            </button>
          ) : null}
          <button type="button" className="danger" disabled={pending} onClick={() => void onTrash()}>
            <Icon name="trash" />
            В корзину
          </button>
        </div>
      </div>
    </div>
  );
}

function ChoiceSplit({
  items,
  selectedIds,
  pending,
  colorful,
  onToggle,
}: {
  items: NamedRecord[];
  selectedIds: number[];
  pending: boolean;
  colorful: boolean;
  onToggle: (id: number) => void;
}) {
  const selected = items.filter((item) => selectedIds.includes(item.id));
  const rest = items.filter((item) => !selectedIds.includes(item.id));

  function pills(list: NamedRecord[], on: boolean) {
    return (
      <div className="choice-cloud">
        {list.map((item) => (
          <button
            key={item.id}
            type="button"
            className={colorful ? `choice-pill tone-${item.id % 6}${on ? " on" : ""}` : on ? "choice-pill on" : "choice-pill"}
            disabled={pending}
            aria-pressed={on}
            onClick={() => onToggle(item.id)}
          >
            {item.name}
            <span>{on ? "×" : "+"}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="choice-split">
      {selected.length > 0 ? pills(selected, true) : null}
      {selected.length > 0 && rest.length > 0 ? <hr /> : null}
      {rest.length > 0 ? pills(rest, false) : null}
    </div>
  );
}

function matchesShelf(
  document: DocumentRecord,
  shelf: ShelfView,
  query: string,
  tagIds: number | null,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle && !document.title.toLocaleLowerCase().includes(needle)) {
    return false;
  }
  if (shelf === "loose" && document.shelfIds.length > 0) {
    return false;
  }
  if (typeof shelf === "number" && !document.shelfIds.includes(shelf)) {
    return false;
  }
  return tagIds === null || document.tagIds.includes(tagIds);
}

function formatSize(size: number | null): string {
  if (size === null) {
    return "неизвестен";
  }
  const megabytes = size / (1024 * 1024);
  if (megabytes > 0 && megabytes < 0.01) {
    return "< 0,01 МБ";
  }
  const digits = megabytes >= 10 ? 1 : 2;
  return `${megabytes.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} МБ`;
}

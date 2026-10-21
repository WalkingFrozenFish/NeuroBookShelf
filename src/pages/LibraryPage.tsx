import { locale, t } from "../i18n";
import { DragEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { AnnotationMode, type RenderTask } from "pdfjs-dist";
import { confirmAction } from "../confirm";
import { Icon } from "../icons";
import { SettingsPage } from "./SettingsPage";
import { TrashPage } from "./TrashPage";
import { type Appearance } from "../theme";
import { openPdf } from "../pdfSetup";
import {
  createShelf,
  createTag,
  clearLibrary,
  databasePath,
  openDatabaseFolder,
  deleteDocumentNotes,
  deleteDocumentTranslations,
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
  seedMockLibrary,
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
  onOpenDictionary,
  appearance,
  onAppearance,
  appearancePending,
}: {
  onOpen: (id: number) => void;
  onOpenDictionary: () => void;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => Promise<void>;
  appearancePending: boolean;
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
        <h1>{t("Библиотека")}</h1>
        {error ? <p className="error">{error}</p> : <p>{t("Загрузка библиотеки…")}</p>}
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
        onOpenDictionary={onOpenDictionary}
        onUpdate={(id, title, shelfIds, tagIds) =>
          run(() => updateDocument(id, title, shelfIds, tagIds).then(() => undefined))
        }
        onTrash={(id) => run(() => trashDocument(id))}
        onClearTranslations={(id) =>
          run(async () => {
            await deleteDocumentTranslations(id);
            setNotice(t("Переводы этой книги удалены"));
          })
        }
        onClearNotes={(id) =>
          run(async () => {
            await deleteDocumentNotes(id);
            setNotice(t("Заметки этой книги удалены"));
          })
        }
        onExport={(id) =>
          run(async () => {
            const exported = await exportPdf(id);
            if (exported) {
              setNotice(t("PDF экспортирован в {0}", [exported]));
            }
          })
        }
        onImport={() => run(() => importPdf().then(() => undefined))}
        onAddToShelf={addToShelf}
        onCreateShelf={(name) => run(() => createShelf(name).then(() => undefined))}
        onUpdateShelf={(id, name) => run(() => updateShelf(id, name).then(() => undefined))}
        onDeleteShelf={async (id, name) => {
          if (await confirmAction(t("Удалить полку «{0}»? Книги останутся в библиотеке.", [name]))) {
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
          if (await confirmAction(t("Удалить тег «{0}»? Связи с документами будут сняты.", [name]))) {
            return run(() => deleteTag(id));
          }
          return Promise.resolve(false);
        }}
        onLibraryChanged={reload}
        databasePath={data.path}
        onOpenDatabaseFolder={() => run(openDatabaseFolder)}
        appearance={appearance}
        onAppearance={onAppearance}
        appearancePending={appearancePending}
        onRelocate={() =>
          run(async () => {
            const path = await relocateDatabase();
            if (path) {
              setNotice(t("База скопирована в {0}", [path]));
            }
          })
        }
        onResetShelves={() => run(() => resetShelves())}
        onResetTags={() => run(() => resetTags())}
        onClearLibrary={() => run(() => clearLibrary())}
        onSeed={async () => {
          if (
            !(await confirmAction(
              t("Добавить примеры в библиотеку? Появятся книги с короткими PDF, полки, теги, слова и две книги в корзине."),
            ))
          ) {
            return false;
          }
          return run(async () => {
            setNotice(await seedMockLibrary());
          });
        }}
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
  onOpenDictionary,
  onUpdate,
  onTrash,
  onClearTranslations,
  onClearNotes,
  onExport,
  onImport,
  onAddToShelf,
  onCreateShelf,
  onUpdateShelf,
  onDeleteShelf,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onLibraryChanged,
  databasePath,
  onOpenDatabaseFolder,
  appearance,
  onAppearance,
  appearancePending,
  onRelocate,
  onResetShelves,
  onResetTags,
  onClearLibrary,
  onSeed,
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
  onOpenDictionary: () => void;
  onUpdate: (
    id: number,
    title: string,
    shelfIds: number[],
    tagIds: number[],
  ) => Promise<boolean>;
  onTrash: (id: number) => Promise<boolean>;
  onClearTranslations: (id: number) => Promise<boolean>;
  onClearNotes: (id: number) => Promise<boolean>;
  onExport: (id: number) => Promise<boolean>;
  onImport: () => Promise<boolean>;
  onAddToShelf: (documentId: number, shelfId: number) => Promise<boolean>;
  onCreateShelf: (name: string) => Promise<boolean>;
  onUpdateShelf: (id: number, name: string) => Promise<boolean>;
  onDeleteShelf: (id: number, name: string) => Promise<boolean>;
  onCreateTag: (name: string) => Promise<boolean>;
  onUpdateTag: (id: number, name: string) => Promise<boolean>;
  onDeleteTag: (id: number, name: string) => Promise<boolean>;
  onLibraryChanged: () => Promise<void>;
  databasePath: string;
  onOpenDatabaseFolder: () => Promise<boolean>;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => Promise<void>;
  appearancePending: boolean;
  onRelocate: () => Promise<boolean>;
  onResetShelves: () => Promise<boolean>;
  onResetTags: () => Promise<boolean>;
  onClearLibrary: () => Promise<boolean>;
  onSeed: () => Promise<boolean>;
  error: string;
  notice: string;
}) {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [settingsId, setSettingsId] = useState<number | null>(null);
  const [view, setView] = useState<"books" | "settings" | "trash">("books");
  const settingsOpen = view === "settings";
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
    openShelf === "all" ? t("Все книги") : openShelf === "loose" ? t("Без полки") : shelves.find((shelf) => shelf.id === openShelf)?.name ?? t("Полка");
  const settingsBook = settingsId === null ? null : documents.find((document) => document.id === settingsId) ?? null;

  function chooseShelf(shelf: ShelfView) {
    setView("books");
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
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      <div
        className="library-workspace"
        style={{ "--shelf-column": `${shelfWidth}px` } as React.CSSProperties}
      >
        <aside className="shelf-column" aria-label={t("Полки")}>
          <div className="shelf-frame">
          <div className="shelf-scroll">
          <ul className="mini-list">
            <li>
              <button
                type="button"
                className={view === "books" && openShelf === "all" ? "mini-row active" : "mini-row"}
                onClick={() => chooseShelf("all")}
              >
                <span>{t("Все книги")}</span>
                <span className="count">{documents.length}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className={view === "books" && openShelf === "loose" ? "mini-row active" : "mini-row"}
                onClick={() => chooseShelf("loose")}
              >
                <span>{t("Без полки")}</span>
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
              {t("Полки")}</button>
            <button
              type="button"
              className="icon-button"
              aria-label={t("Новая полка")}
              disabled={pending}
              onClick={() => setDialog({ kind: "create-shelf" })}
            >
              +
            </button>
          </div>
          {shelvesOpen ? (
            <>
              {shelves.length === 0 ? <p className="meta">{t("Полок пока нет.")}</p> : null}
              <ul className="mini-list">
                {shelves.map((shelf) => (
                  <li key={shelf.id}>
                    <ShelfDrop
                      pending={pending}
                      label={shelf.name}
                      onDrop={(documentId) => onAddToShelf(documentId, shelf.id)}
                    >
                      <div className={view === "books" && openShelf === shelf.id ? "shelf-line active" : "shelf-line"}>
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
                        {openShelf === shelf.id && view === "books" ? (
                          <button
                            type="button"
                            className="icon-button shelf-more"
                            aria-label={t("Действия: {0}", [shelf.name])}
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
              {t("Теги")}</button>
            <button
              type="button"
              className="icon-button"
              aria-label={t("Новый тег")}
              disabled={pending}
              onClick={() => setDialog({ kind: "create-tag" })}
            >
              +
            </button>
          </div>
          {tagsOpen ? (
            <>
              {tags.length === 0 ? <p className="meta">{t("Тегов пока нет.")}</p> : null}
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
                      aria-label={t("Действия: {0}", [tag.name])}
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
          <div className="library-sidebar-footer">
          <button type="button" className={view === "trash" ? "settings-entry active" : "settings-entry"}
            aria-current={view === "trash" ? "page" : undefined} onClick={() => setView("trash")}>
            <Icon name="trash" />{t("Корзина")}
          </button>
          <button
            type="button"
            className={settingsOpen ? "settings-entry active" : "settings-entry"}
            aria-current={settingsOpen ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            <Icon name="settings" />
            {t("Настройки")}</button>
          </div>
          </div>
          <div
            className="shelf-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("Ширина меню")}
            aria-valuemin={SHELF_MIN}
            aria-valuemax={SHELF_MAX}
            aria-valuenow={shelfWidth}
            title={t("Потяните, чтобы изменить ширину")}
            onPointerDown={onShelfResizeStart}
          >
            ⋮
          </div>
        </aside>
        <div className="book-stage">
          {settingsOpen ? (
            <>
            <SettingsPage appearance={appearance} onAppearance={onAppearance} appearancePending={appearancePending}
              pending={pending} databasePath={databasePath} onOpenDatabaseFolder={onOpenDatabaseFolder}
              onRelocate={onRelocate} onSeed={onSeed} onRequestReset={setConfirmKind} />
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
          ) : view === "trash" ? <TrashPage onLibraryChanged={onLibraryChanged} /> : (
            <>
          <header className="library-toolbar">
            <div className="library-title">
              <h1>{shelfName}</h1>
              <span className="count" aria-label={t("Книг: {0}", [visible.length])}>{visible.length}</span>
            </div>
            <label className="library-search">
              <span className="sr-only">{t("Поиск книг на выбранной полке")}</span>
              <input
                type="search"
                value={query}
                placeholder={t("Поиск книг")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="button" className="primary" disabled={pending} onClick={() => void onImport()}>
              <Icon name="import" />
              {t("Импорт PDF")}</button>
          </header>
          <ul className="book-grid">
          <li className="dictionary-tile" data-dictionary-card="">
            <button type="button" className="book-cover dictionary-open" onClick={onOpenDictionary}>
              <span className="dictionary-cover">
                <span className="dictionary-cover-kicker">EN · RU</span>
                <span className="dictionary-cover-mark">Aa</span>
              </span>
              <strong className="book-name">{t("Словарь")}</strong>
            </button>
            <p className="dictionary-tile-note">{t("Слова из книг")}</p>
            <button type="button" className="book-read primary" onClick={onOpenDictionary}>
              <Icon name="dictionary" />
              {t("Открыть")}</button>
          </li>
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
                {document.path ? <BookCover documentId={document.id} /> : <span className="cover-fallback">{t("Нет PDF")}</span>}
                <strong className="book-name" title={document.title}>
                  {document.title}
                </strong>
              </div>
              <button
                type="button"
                className="book-menu"
                aria-label={t("Настройки: {0}", [document.title])}
                disabled={pending}
                onClick={() => setSettingsId(document.id)}
              >
                ⋮
              </button>
              <div className="book-meta">
                <LinkPreview label={t("Полки")} items={shelves} ids={document.shelfIds} colorful={false} />
                <LinkPreview label={t("Теги")} items={tags} ids={document.tagIds} colorful />
              </div>
              <button
                type="button"
                className="book-read primary"
                disabled={!document.path || pending}
                onClick={() => onOpen(document.id)}
              >
                <Icon name="read" />
                {t("Читать")}</button>
            </li>
          ))}
        </ul>
          {documents.length === 0 ? (
            <p>{t("Документов пока нет.")}</p>
          ) : visible.length === 0 ? (
            <p>{t("Ничего не найдено.")}</p>
          ) : null}
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
            if (await confirmAction(t("Переместить «{0}» в корзину? Файл не будет удалён с диска.", [settingsBook.title]))) {
              return onTrash(settingsBook.id);
            }
            return Promise.resolve(false);
          }}
          onClearTranslations={async () => {
            if (await confirmAction(t("Удалить все переводы в «{0}»? Закладки и заметки останутся.", [settingsBook.title]))) {
              return onClearTranslations(settingsBook.id);
            }
            return false;
          }}
          onClearNotes={async () => {
            if (await confirmAction(t("Удалить все заметки в «{0}»? Переводы и закладки останутся.", [settingsBook.title]))) {
              return onClearNotes(settingsBook.id);
            }
            return false;
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
          title: t("Сбросить полки"),
          text: t("Все полки будут удалены. Книги и теги останутся."),
          question: t("Точно сбросить все полки?"),
          confirm: t("Да, сбросить"),
        }
      : kind === "tags"
        ? {
            title: t("Сбросить теги"),
            text: t("Все теги будут удалены. Книги и полки останутся."),
            question: t("Точно сбросить все теги?"),
            confirm: t("Да, сбросить"),
          }
        : {
            title: t("Очистить библиотеку"),
            text: t("Книги будут удалены из библиотеки навсегда, восстановить их будет нельзя. Файлы на компьютере останутся."),
            question: t("Точно удалить все книги?"),
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
            {t("Нет, оставить")}</button>
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
      ? t("Новая полка")
      : dialog.kind === "create-tag"
        ? t("Новый тег")
        : dialog.kind === "shelf"
          ? t("Полка")
          : t("Тег");

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
        {dialog.kind === "shelf" ? <p className="meta">{t("Книги останутся в библиотеке.")}</p> : null}
        <label>
          {t("Название")}<input
            value={name}
            maxLength={NAME_LIMIT}
            onChange={(event) => setName(Array.from(event.target.value).slice(0, NAME_LIMIT).join(""))}
            disabled={pending}
            autoFocus
          />
        </label>
        {nameLength > NAME_LIMIT ? <p className="meta">{t("Не больше 30 символов.")}</p> : null}
        <div className="actions">
          <button type="submit" className="primary" disabled={pending || name.trim() === "" || nameLength > NAME_LIMIT}>
            {creating ? t("Создать") : t("Сохранить")}
          </button>
          <button type="button" disabled={pending} onClick={onClose}>
            {t("Отмена")}</button>
          {creating ? null : (
            <button type="button" className="danger" disabled={pending} onClick={() => void remove()}>
              {t("Удалить")}</button>
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
    let loading: ReturnType<typeof openPdf> | null = null;
    async function draw() {
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
        {linked.length === 0 ? <span className="meta">{t("нет")}</span> : null}
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
  onClearTranslations,
  onClearNotes,
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
  onClearTranslations: () => Promise<boolean>;
  onClearNotes: () => Promise<boolean>;
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
        <button type="button" className="settings-close" aria-label={t("Закрыть")} onClick={onClose}>
          <Icon name="clear" />
        </button>
        <div className="settings-line">
          <span className="settings-kicker">{t("Название документа")}</span>
          <span className="settings-plain" title={document.originalFilename ?? undefined}>
            {document.originalFilename ?? t("Без файла")}
            {document.originalFilename ? <span className="meta"> {formatSize(document.fileSize)}</span> : null}
          </span>
        </div>
        <div className="settings-line">
          <span className="settings-kicker">{t("Название")}</span>
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
                {t("Сохранить")}</button>
              <button type="button" disabled={pending} onClick={resetTitle}>
                {t("Сбросить")}</button>
            </div>
          ) : (
            <>
              <span className="settings-plain">{document.title}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={t("Изменить название")}
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
        <h3>{t("Полки")}</h3>
        {shelves.length === 0 ? (
          <p className="meta">{t("Полок пока нет.")}</p>
        ) : (
          <ChoiceSplit
            items={shelves}
            selectedIds={document.shelfIds}
            pending={pending}
            colorful={false}
            onToggle={(id) => void onSetLinks(toggleId(document.shelfIds, id), document.tagIds)}
          />
        )}
        <h3>{t("Теги")}</h3>
        {tags.length === 0 ? (
          <p className="meta">{t("Тегов пока нет.")}</p>
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
            <section className="settings-block">
              <h3>{t("Экспорт")}</h3>
              <p className="meta">{t("Сохранить PDF этой книги в выбранное место.")}</p>
              <button type="button" disabled={pending} onClick={() => void onExport()}>
                {t("Экспорт")}</button>
            </section>
          ) : null}
          <section className="settings-block">
            <h3>{t("Переводы")}</h3>
            <p className="meta">{t("Будут удалены все переводы этой книги. Закладки и заметки останутся.")}</p>
            <button type="button" className="danger" disabled={pending} onClick={() => void onClearTranslations()}>
              {t("Удалить переводы")}</button>
          </section>
          <section className="settings-block">
            <h3>{t("Заметки")}</h3>
            <p className="meta">{t("Будут удалены все заметки этой книги. Переводы и закладки останутся.")}</p>
            <button type="button" className="danger" disabled={pending} onClick={() => void onClearNotes()}>
              {t("Удалить заметки")}</button>
          </section>
          <section className="settings-block">
            <h3>{t("Корзина")}</h3>
            <p className="meta">{t("Книга исчезнет из библиотеки. Файл на компьютере не удаляется.")}</p>
            <button type="button" className="danger" disabled={pending} onClick={() => void onTrash()}>
              {t("В корзину")}</button>
          </section>
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

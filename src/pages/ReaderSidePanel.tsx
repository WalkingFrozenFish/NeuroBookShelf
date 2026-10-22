import { t } from "../i18n";
import { FormEvent, useEffect, useState } from "react";
import { confirmAction } from "../confirm";
import { Icon } from "../icons";
import {
  BookmarkRecord,
  createBookmark,
  createDictionaryEntry,
  createNote,
  deleteBookmark,
  deleteNote,
  DictionaryScope,
  deleteTranslationBlock,
  errorText,
  listBookmarks,
  listNotes,
  listTranslationBlocks,
  NoteRecord,
  TranslationBlockRecord,
  updateNote,
} from "../libraryApi";
import { ReaderDictionary } from "./ReaderDictionary";

type TabId = "notes" | "bookmarks" | "translations" | "dictionary";

type Editing = {
  id: number;
  pageNumber: number | null;
  body: string;
};

export function ReaderSidePanel({
  width,
  onResizeStart,
  documentId,
  pageNumber,
  onOpenPage,
  onDirtyChange,
  blocksVersion,
  highlightedId,
  onHighlight,
  onShowOverlay,
  onShowPopup,
  onBlocksChanged,
  dictionaryRequest,
}: {
  width: number;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  documentId: number;
  pageNumber: number;
  onOpenPage: (pageNumber: number) => void;
  onDirtyChange: (pageDirty: boolean, anyDirty: boolean) => void;
  blocksVersion: number;
  highlightedId: number | null;
  onHighlight: (block: TranslationBlockRecord) => void;
  onShowOverlay: () => void;
  onShowPopup: (id: number) => void;
  onBlocksChanged: () => void;
  dictionaryRequest: number;
}) {
  const [tab, setTab] = useState<TabId>("notes");
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [label, setLabel] = useState("");
  const [documentDraft, setDocumentDraft] = useState("");
  const [pageDraft, setPageDraft] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [blocks, setBlocks] = useState<TranslationBlockRecord[]>([]);
  const [blockError, setBlockError] = useState("");
  const [blockPending, setBlockPending] = useState(false);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [translationMenu, setTranslationMenu] = useState<number | null>(null);
  const [openNoteGroups, setOpenNoteGroups] = useState<Array<number | "document">>(["document"]);
  const [pageNotesOpen, setPageNotesOpen] = useState(true);
  const [openBookmarkPages, setOpenBookmarkPages] = useState<number[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(true);
  const [dictionaryScope, setDictionaryScope] = useState<DictionaryScope>("document");
  const [dictionaryRevision, setDictionaryRevision] = useState(0);

  useEffect(() => {
    if (dictionaryRequest === 0) {
      return;
    }
    setDictionaryScope("global");
    setDictionaryRevision((current) => current + 1);
    setTab("dictionary");
  }, [dictionaryRequest]);

  const editingNote = editing ? notes.find((note) => note.id === editing.id) : undefined;
  const editingDirty = Boolean(editing && editingNote && editing.body !== editingNote.body);
  const pageEditDirty = Boolean(
    editingDirty && editingNote && editingNote.pageNumber === pageNumber,
  );
  const documentEditDirty = Boolean(editingDirty && editingNote && editingNote.pageNumber === null);
  const pageDirty = pageDraft.trim() !== "" || pageEditDirty;
  const anyDirty = pageDirty || documentDraft.trim() !== "" || documentEditDirty;

  useEffect(() => {
    onDirtyChange(pageDirty, anyDirty);
  }, [pageDirty, anyDirty, onDirtyChange]);

  useEffect(() => {
    if (translationMenu === null) {
      return;
    }
    function close(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-translation-menu], [data-translation-menu-button]")) {
        return;
      }
      setTranslationMenu(null);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [translationMenu]);

  useEffect(() => {
    setPageDraft("");
    setTranslationMenu(null);
    setOpenNoteGroups((current) => (current.includes(pageNumber) ? current : [...current, pageNumber]));
    setOpenBookmarkPages((current) => (current.includes(pageNumber) ? current : [...current, pageNumber]));
    setEditing((current) => {
      if (!current || current.pageNumber === null || current.pageNumber === pageNumber) {
        return current;
      }
      return null;
    });
  }, [pageNumber]);

  useEffect(() => {
    let active = true;
    setError("");
    setLabel("");
    setDocumentDraft("");
    setPageDraft("");
    setEditing(null);
    Promise.all([listBookmarks(documentId), listNotes(documentId)])
      .then(([bookmarkList, noteList]) => {
        if (active) {
          setBookmarks(bookmarkList);
          setNotes(noteList);
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
  }, [documentId]);

  useEffect(() => {
    let active = true;
    setBlockError("");
    listTranslationBlocks(documentId, pageNumber)
      .then((list) => {
        if (active) {
          setBlocks(list);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setBlocks([]);
          setBlockError(errorText(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, [documentId, pageNumber, blocksVersion]);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await action();
      const [bookmarkList, noteList] = await Promise.all([
        listBookmarks(documentId),
        listNotes(documentId),
      ]);
      setBookmarks(bookmarkList);
      setNotes(noteList);
    } catch (actionError: unknown) {
      setError(errorText(actionError));
    } finally {
      setPending(false);
    }
  }

  function addBookmark(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await createBookmark(documentId, pageNumber, label);
      setLabel("");
      setBookmarksOpen(true);
      setOpenBookmarkPages((current) => (current.includes(pageNumber) ? current : [...current, pageNumber]));
    });
  }

  function addNote(event: FormEvent, scope: "document" | "page") {
    event.preventDefault();
    const draft = scope === "document" ? documentDraft : pageDraft;
    void run(async () => {
      await createNote(documentId, scope === "document" ? null : pageNumber, draft);
      if (scope === "document") {
        setDocumentDraft("");
        setOpenNoteGroups((current) => (current.includes("document") ? current : [...current, "document"]));
      } else {
        setPageDraft("");
        setPageNotesOpen(true);
        setOpenNoteGroups((current) => (current.includes(pageNumber) ? current : [...current, pageNumber]));
      }
    });
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    const body = editing.body;
    const id = editing.id;
    void run(async () => {
      await updateNote(id, body);
      setEditing(null);
    });
  }

  function addBlockToDictionary(scope: DictionaryScope, block: TranslationBlockRecord) {
    setBlockPending(true);
    setBlockError("");
    void createDictionaryEntry(
      scope,
      scope === "document" ? documentId : null,
      block.ocrText,
      block.translatedText,
      "",
    )
      .then(() => {
        setDictionaryScope(scope);
        setDictionaryRevision((current) => current + 1);
        setTab("dictionary");
      })
      .catch((saveError: unknown) => setBlockError(errorText(saveError)))
      .finally(() => setBlockPending(false));
  }

  const documentNotes = notes.filter((note) => note.pageNumber === null);
  const groupedPageNotes = pageNoteGroups(notes);
  const pageNoteCount = groupedPageNotes.reduce((sum, [, items]) => sum + items.length, 0);
  const groupedBookmarks = pageBookmarkGroups(bookmarks);

  function toggleNoteGroup(key: number | "document") {
    setOpenNoteGroups((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function toggleBookmarkPage(page: number) {
    setOpenBookmarkPages((current) =>
      current.includes(page) ? current.filter((item) => item !== page) : [...current, page],
    );
  }

  function noteList(items: NoteRecord[]) {
    return (
      <NoteList
        notes={items}
        pending={pending}
        editing={editing}
        onEdit={setEditing}
        onEditBody={(body) => setEditing((current) => (current ? { ...current, body } : current))}
        onSave={saveEdit}
        onCancel={() => setEditing(null)}
        onDelete={(id) => {
          void (async () => {
            if (await confirmAction(t("Удалить заметку?"))) {
              void run(() => deleteNote(id));
            }
          })();
        }}
      />
    );
  }

  return (
    <aside className="reader-side" aria-label={t("Дополнительная панель")}>
      <div
        className="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Ширина панели")}
        aria-valuemin={300}
        aria-valuemax={500}
        aria-valuenow={width}
        title={t("Потяните, чтобы изменить ширину")}
        onPointerDown={onResizeStart}
      >
        ⋮
      </div>
      <div className="side-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notes"}
          className={tab === "notes" ? "active" : undefined}
          onClick={() => setTab("notes")}
        >
          <Icon name="notes" />
          {t("Заметки")}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bookmarks"}
          className={tab === "bookmarks" ? "active" : undefined}
          onClick={() => setTab("bookmarks")}
        >
          <Icon name="bookmark" />
          {t("Закладки")}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "translations"}
          className={tab === "translations" ? "active" : undefined}
          onClick={() => setTab("translations")}
        >
          <Icon name="translate" />
          {t("Переводы")}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "dictionary"}
          className={tab === "dictionary" ? "active" : undefined}
          onClick={() => setTab("dictionary")}
        >
          <Icon name="dictionary" />
          {t("Словарь")}</button>
      </div>
      <div className="side-body" hidden={tab !== "notes"}>
        {error && tab === "notes" ? <p className="error">{error}</p> : null}
        <form className="side-form note-form" onSubmit={(event) => addNote(event, "page")}>
          <textarea
            data-page-note
            value={pageDraft}
            placeholder={t("Заметка к странице {0}", [pageNumber])}
            disabled={pending}
            onChange={(event) => setPageDraft(event.target.value)}
          />
          <button type="submit" disabled={pending || pageDraft.trim() === ""}>
            {t("Добавить заметку")}</button>
        </form>
        <div className="note-groups">
          <section
            className="note-group"
            data-note-page="document"
            data-note-open={openNoteGroups.includes("document") ? "1" : "0"}
          >
            <div className="note-group-head">
              <button
                type="button"
                className="note-group-toggle"
                aria-expanded={openNoteGroups.includes("document")}
                data-count={documentNotes.length}
                onClick={() => toggleNoteGroup("document")}
              >
                {t("Общие заметки")}</button>
            </div>
            {openNoteGroups.includes("document") ? (
              <div className="note-group-body">
                {noteList(documentNotes)}
                <form className="side-form note-form" onSubmit={(event) => addNote(event, "document")}>
                  <textarea
                    value={documentDraft}
                    placeholder={t("Новая общая заметка")}
                    disabled={pending}
                    onChange={(event) => setDocumentDraft(event.target.value)}
                  />
                  <button type="submit" disabled={pending || documentDraft.trim() === ""}>
                    {t("Добавить общую")}</button>
                </form>
              </div>
            ) : null}
          </section>
          <section
            className="note-group"
            data-note-page="pages"
            data-note-open={pageNotesOpen ? "1" : "0"}
          >
            <div className="note-group-head">
              <button
                type="button"
                className="note-group-toggle"
                aria-expanded={pageNotesOpen}
                data-count={pageNoteCount}
                onClick={() => setPageNotesOpen((current) => !current)}
              >
                {t("По страницам")}</button>
            </div>
            {pageNotesOpen ? (
              <div className="note-group-body">
                {groupedPageNotes.length === 0 ? (
                  <p className="meta">{t("Заметок на страницах пока нет.")}</p>
                ) : (
                  groupedPageNotes.map(([groupPage, groupNotes]) => {
                    const open = openNoteGroups.includes(groupPage);
                    return (
                      <section
                        key={groupPage}
                        className={groupPage === pageNumber ? "note-group current" : "note-group"}
                        data-note-page={groupPage}
                        data-note-open={open ? "1" : "0"}
                      >
                        <div className="note-group-head">
                          <button
                            type="button"
                            className="note-group-toggle"
                            aria-expanded={open}
                            data-count={groupNotes.length}
                            onClick={() => toggleNoteGroup(groupPage)}
                          >
                            {t("Страница {0}", [groupPage])}
                          </button>
                          {groupPage === pageNumber ? null : (
                            <button type="button" onClick={() => onOpenPage(groupPage)}>
                              {t("К странице")}</button>
                          )}
                        </div>
                        {open ? <div className="note-group-body">{noteList(groupNotes)}</div> : null}
                      </section>
                    );
                  })
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
      <div className="side-body" hidden={tab !== "bookmarks"}>
        {error && tab === "bookmarks" ? <p className="error">{error}</p> : null}
        <form className="side-form bookmark-form" onSubmit={addBookmark}>
          <textarea
            value={label}
            placeholder={t("Заметка к закладке, необязательно")}
            disabled={pending}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button type="submit" disabled={pending}>
            {t("Добавить закладку")}</button>
        </form>
        <div className="note-groups">
          <section className="note-group" data-bookmark-group="pages" data-bookmark-open={bookmarksOpen ? "1" : "0"}>
            <div className="note-group-head">
              <button
                type="button"
                className="note-group-toggle"
                aria-expanded={bookmarksOpen}
                data-count={bookmarks.length}
                onClick={() => setBookmarksOpen((current) => !current)}
              >
                {t("По страницам")}</button>
            </div>
            {bookmarksOpen ? (
              <div className="note-group-body">
                {groupedBookmarks.length === 0 ? (
                  <p className="meta">{t("Закладок пока нет.")}</p>
                ) : (
                  groupedBookmarks.map(([groupPage, groupBookmarks]) => {
                    const open = openBookmarkPages.includes(groupPage);
                    return (
                      <section
                        key={groupPage}
                        className={groupPage === pageNumber ? "note-group current" : "note-group"}
                        data-bookmark-group={groupPage}
                        data-bookmark-open={open ? "1" : "0"}
                      >
                        <div className="note-group-head">
                          <button
                            type="button"
                            className="note-group-toggle"
                            aria-expanded={open}
                            data-count={groupBookmarks.length}
                            onClick={() => toggleBookmarkPage(groupPage)}
                          >
                            {t("Страница {0}", [groupPage])}
                          </button>
                          {groupPage === pageNumber ? null : (
                            <button type="button" onClick={() => onOpenPage(groupPage)}>
                              {t("К странице")}</button>
                          )}
                        </div>
                        {open ? (
                          <div className="note-group-body">
                            <ul className="side-list">
                              {groupBookmarks.map((bookmark) => (
                                <li
                                  key={bookmark.id}
                                  data-bookmark-id={bookmark.id}
                                  data-bookmark-page={bookmark.pageNumber}
                                  className={bookmark.pageNumber === pageNumber ? "bookmark-card current" : "bookmark-card"}
                                >
                                  <button
                                    type="button"
                                    className="bookmark-open"
                                    onClick={() => onOpenPage(bookmark.pageNumber)}
                                  >
                                    <span className="bookmark-text">
                                      {bookmark.label || t("Страница {0}", [bookmark.pageNumber])}
                                    </span>
                                  </button>
                                  <div className="bookmark-actions">
                                    <button
                                      type="button"
                                      className="icon-button"
                                      aria-label={t("Удалить")}
                                      disabled={pending}
                                      onClick={() => {
                                        void (async () => {
                                          if (await confirmAction(t("Удалить закладку?"))) {
                                            void run(() => deleteBookmark(bookmark.id));
                                          }
                                        })();
                                      }}
                                    >
                                      <Icon name="trash" />
                                      <span className="sr-only">{t("Удалить")}</span>
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </section>
                    );
                  })
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
      <div className="side-body" hidden={tab !== "translations"}>
        {blockError ? <p className="error">{blockError}</p> : null}
        {blocks.length === 0 ? (
          <p className="meta">{t("На этой странице переводов нет.")}</p>
        ) : (
          <ul className="side-list">
            {blocks.map((block) => {
              const open = expanded.includes(block.id);
              return (
                <li
                  key={block.id}
                  data-translation-id={block.id}
                  className={highlightedId === block.id ? "translation-card highlighted" : "translation-card"}
                >
                  <button
                    type="button"
                    className="translation-menu-button"
                    data-translation-menu-button
                    aria-label={t("Действия перевода")}
                    aria-expanded={translationMenu === block.id}
                    disabled={blockPending}
                    onClick={() => setTranslationMenu((current) => (current === block.id ? null : block.id))}
                  >
                    ⋮
                  </button>
                  {translationMenu === block.id ? (
                    <div className="translation-menu" data-translation-menu role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={blockPending}
                        onClick={() => {
                          setTranslationMenu(null);
                          addBlockToDictionary("document", block);
                        }}
                      >
                        {t("В словарь книги")}</button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={blockPending}
                        onClick={() => {
                          setTranslationMenu(null);
                          addBlockToDictionary("global", block);
                        }}
                      >
                        {t("В общий словарь")}</button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        disabled={blockPending}
                        onClick={() => {
                          setTranslationMenu(null);
                          void (async () => {
                            if (await confirmAction(t("Удалить перевод?"))) {
                              setBlockPending(true);
                              setBlockError("");
                              void deleteTranslationBlock(block.id)
                                .then(() => listTranslationBlocks(documentId, pageNumber))
                                .then((list) => {
                                  setBlocks(list);
                                  onBlocksChanged();
                                })
                                .catch((deleteError: unknown) => setBlockError(errorText(deleteError)))
                                .finally(() => setBlockPending(false));
                            }
                          })();
                        }}
                      >
                        {t("Удалить")}</button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="block-open"
                    onClick={() => {
                      onShowOverlay();
                      onHighlight(block);
                    }}
                  >
                    <span className="lang-label">EN</span>
                    <span className={open ? "block-text" : "block-text clamp"}>{block.ocrText}</span>
                    <span className="translation-split" aria-hidden="true" />
                    <span className="lang-label">RU</span>
                    <span className={open ? "block-text" : "block-text clamp"}>{block.translatedText}</span>
                  </button>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => {
                        onHighlight(block);
                        onShowPopup(block.id);
                      }}
                    >
                      <Icon name="overlay" />
                      {t("Показать")}</button>
                    {block.ocrText.length > 140 || block.translatedText.length > 140 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((current) =>
                            current.includes(block.id)
                              ? current.filter((id) => id !== block.id)
                              : [...current, block.id],
                          )
                        }
                      >
                        {open ? t("Свернуть") : t("Развернуть")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="side-body" hidden={tab !== "dictionary"}>
        <ReaderDictionary
          documentId={documentId}
          scope={dictionaryScope}
          onScope={setDictionaryScope}
          revision={dictionaryRevision}
        />
      </div>
    </aside>
  );
}

function NoteList({
  notes,
  pending,
  editing,
  onEdit,
  onEditBody,
  onSave,
  onCancel,
  onDelete,
}: {
  notes: NoteRecord[];
  pending: boolean;
  editing: Editing | null;
  onEdit: (editing: Editing) => void;
  onEditBody: (body: string) => void;
  onSave: (event: FormEvent) => void;
  onCancel: () => void;
  onDelete: (id: number) => void;
}) {
  if (notes.length === 0) {
    return <p className="meta">{t("Заметок пока нет.")}</p>;
  }
  return (
    <ul className="side-list">
      {notes.map((note) => {
        const active = editing?.id === note.id;
        return (
          <li
            key={note.id}
            className="note-card"
            data-note-id={note.id}
            data-note-scope={note.pageNumber === null ? "document" : "page"}
          >
            {active ? (
              <form className="side-form note-form" onSubmit={onSave}>
                <textarea
                  value={editing.body}
                  disabled={pending}
                  onChange={(event) => onEditBody(event.target.value)}
                />
                <div className="actions">
                  <button type="submit" disabled={pending || editing.body.trim() === ""}>
                    {t("Сохранить")}</button>
                  <button type="button" disabled={pending} onClick={onCancel}>
                    {t("Отмена")}</button>
                </div>
              </form>
            ) : (
              <>
                <p className="note-text">{note.body}</p>
                <div className="note-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Изменить")}
                    disabled={pending}
                    onClick={() =>
                      onEdit({ id: note.id, pageNumber: note.pageNumber, body: note.body })
                    }
                  >
                    <Icon name="edit" />
                    <span className="sr-only">{t("Изменить")}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Удалить")}
                    disabled={pending}
                    onClick={() => onDelete(note.id)}
                  >
                    <Icon name="trash" />
                    <span className="sr-only">{t("Удалить")}</span>
                  </button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function pageBookmarkGroups(bookmarks: BookmarkRecord[]): Array<[number, BookmarkRecord[]]> {
  const groups = new Map<number, BookmarkRecord[]>();
  for (const bookmark of bookmarks) {
    const list = groups.get(bookmark.pageNumber) ?? [];
    list.push(bookmark);
    groups.set(bookmark.pageNumber, list);
  }
  return [...groups.entries()].sort((left, right) => left[0] - right[0]);
}

function pageNoteGroups(notes: NoteRecord[]): Array<[number, NoteRecord[]]> {
  const groups = new Map<number, NoteRecord[]>();
  for (const note of notes) {
    if (note.pageNumber === null) {
      continue;
    }
    const list = groups.get(note.pageNumber) ?? [];
    list.push(note);
    groups.set(note.pageNumber, list);
  }
  return [...groups.entries()].sort((left, right) => left[0] - right[0]);
}

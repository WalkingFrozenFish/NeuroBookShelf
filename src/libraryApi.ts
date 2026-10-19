import { invoke } from "@tauri-apps/api/core";

export type DocumentRecord = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  originalFilename: string | null;
  internalFilename: string | null;
  path: string | null;
  fileSize: number | null;
  hash: string | null;
  shelfIds: number[];
  tagIds: number[];
  deletedAt: string | null;
  lastPage: number;
  lastZoom: string;
};

export type NamedRecord = {
  id: number;
  name: string;
  createdAt: string;
};

export function databasePath(): Promise<string> {
  return invoke<string>("database_path");
}

export function getTheme(): Promise<string> {
  return invoke<string>("get_theme");
}

export function setTheme(theme: string): Promise<void> {
  return invoke("set_theme", { theme });
}

export function relocateDatabase(): Promise<string | null> {
  return invoke<string | null>("relocate_database");
}

export function resetShelves(): Promise<void> {
  return invoke("reset_shelves");
}

export function resetTags(): Promise<void> {
  return invoke("reset_tags");
}

export function clearLibrary(): Promise<void> {
  return invoke("clear_library");
}

export function listDocuments(): Promise<DocumentRecord[]> {
  return invoke<DocumentRecord[]>("list_documents");
}

export function createDocument(
  title: string,
  shelfIds: number[],
  tagIds: number[],
): Promise<DocumentRecord> {
  return invoke<DocumentRecord>("create_document", { title, shelfIds, tagIds });
}

export function updateDocument(
  id: number,
  title: string,
  shelfIds: number[],
  tagIds: number[],
): Promise<DocumentRecord> {
  return invoke<DocumentRecord>("update_document", { id, title, shelfIds, tagIds });
}

export function trashDocument(id: number): Promise<void> {
  return invoke("trash_document", { id });
}

export function listTrash(): Promise<DocumentRecord[]> {
  return invoke<DocumentRecord[]>("list_trash");
}

export function restoreDocument(id: number): Promise<DocumentRecord> {
  return invoke<DocumentRecord>("restore_document", { id });
}

export function purgeDocument(id: number): Promise<void> {
  return invoke("purge_document", { id });
}

export function exportPdf(id: number): Promise<string | null> {
  return invoke<string | null>("export_pdf", { id });
}

export function getDocument(id: number): Promise<DocumentRecord> {
  return invoke<DocumentRecord>("get_document", { id });
}

export function readDocumentPdf(id: number): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_document_pdf", { id });
}

export function saveReadingState(id: number, page: number, zoom: string): Promise<void> {
  return invoke("save_reading_state", { id, page, zoom });
}

export type BookmarkRecord = {
  id: number;
  documentId: number;
  pageNumber: number;
  label: string;
  createdAt: string;
};

export type NoteRecord = {
  id: number;
  documentId: number;
  pageNumber: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export function listBookmarks(documentId: number): Promise<BookmarkRecord[]> {
  return invoke<BookmarkRecord[]>("list_bookmarks", { documentId });
}

export function createBookmark(
  documentId: number,
  pageNumber: number,
  label: string,
): Promise<BookmarkRecord> {
  return invoke<BookmarkRecord>("create_bookmark", { documentId, pageNumber, label });
}

export function deleteBookmark(id: number): Promise<void> {
  return invoke("delete_bookmark", { id });
}

export function listNotes(documentId: number): Promise<NoteRecord[]> {
  return invoke<NoteRecord[]>("list_notes", { documentId });
}

export function createNote(
  documentId: number,
  pageNumber: number | null,
  body: string,
): Promise<NoteRecord> {
  return invoke<NoteRecord>("create_note", { documentId, pageNumber, body });
}

export function updateNote(id: number, body: string): Promise<NoteRecord> {
  return invoke<NoteRecord>("update_note", { id, body });
}

export function deleteNote(id: number): Promise<void> {
  return invoke("delete_note", { id });
}

export type DictionaryScope = "document" | "global";

export type DictionaryEntryRecord = {
  id: number;
  dictionaryId: number;
  sourceText: string;
  translatedText: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export function listDictionaryEntries(
  scope: DictionaryScope,
  documentId: number | null,
  query: string,
): Promise<DictionaryEntryRecord[]> {
  return invoke<DictionaryEntryRecord[]>("list_dictionary_entries", { scope, documentId, query });
}

export function createDictionaryEntry(
  scope: DictionaryScope,
  documentId: number | null,
  sourceText: string,
  translatedText: string,
  note: string,
): Promise<DictionaryEntryRecord> {
  return invoke<DictionaryEntryRecord>("create_dictionary_entry", {
    scope,
    documentId,
    sourceText,
    translatedText,
    note,
  });
}

export function updateDictionaryEntry(
  id: number,
  sourceText: string,
  translatedText: string,
  note: string,
): Promise<DictionaryEntryRecord> {
  return invoke<DictionaryEntryRecord>("update_dictionary_entry", {
    id,
    sourceText,
    translatedText,
    note,
  });
}

export function deleteDictionaryEntry(id: number): Promise<void> {
  return invoke("delete_dictionary_entry", { id });
}

export type TranslationBlockRecord = {
  id: number;
  documentId: number;
  pageNumber: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  ocrText: string;
  translatedText: string;
  createdAt: string;
  updatedAt: string;
  popupX: number | null;
  popupY: number | null;
  popupWidth: number | null;
  popupHeight: number | null;
};

export function listTranslationBlocks(
  documentId: number,
  pageNumber: number,
): Promise<TranslationBlockRecord[]> {
  return invoke<TranslationBlockRecord[]>("list_translation_blocks", { documentId, pageNumber });
}

export type TranslationVersionRecord = {
  id: number;
  translationBlockId: number;
  translatedText: string;
  translator: string;
  createdAt: string;
  isActive: boolean;
};

export function createTranslationBlock(
  documentId: number,
  pageNumber: number,
  rect: { x: number; y: number; width: number; height: number },
  ocrText: string,
  translatedText: string,
  translator: string,
): Promise<TranslationBlockRecord> {
  return invoke<TranslationBlockRecord>("create_translation_block", {
    documentId,
    pageNumber,
    sourceX: rect.x,
    sourceY: rect.y,
    sourceWidth: rect.width,
    sourceHeight: rect.height,
    ocrText,
    translatedText,
    translator,
  });
}

export function updateTranslationBlock(
  id: number,
  ocrText: string,
  translatedText: string,
): Promise<TranslationBlockRecord> {
  return invoke<TranslationBlockRecord>("update_translation_block", { id, ocrText, translatedText });
}

export function deleteTranslationBlock(id: number): Promise<void> {
  return invoke("delete_translation_block", { id });
}

export function listTranslationVersions(blockId: number): Promise<TranslationVersionRecord[]> {
  return invoke<TranslationVersionRecord[]>("list_translation_versions", { blockId });
}

export function activateTranslationVersion(versionId: number): Promise<TranslationBlockRecord> {
  return invoke<TranslationBlockRecord>("activate_translation_version", { versionId });
}

export function retranslateTranslationBlock(id: number): Promise<TranslationBlockRecord> {
  return invoke<TranslationBlockRecord>("retranslate_translation_block", { id });
}

export function updateTranslationPopup(
  id: number,
  rect: { x: number; y: number; width: number; height: number },
): Promise<TranslationBlockRecord> {
  return invoke<TranslationBlockRecord>("update_translation_popup", {
    id,
    popupX: rect.x,
    popupY: rect.y,
    popupWidth: rect.width,
    popupHeight: rect.height,
  });
}

export function importPdf(): Promise<DocumentRecord | null> {
  return invoke<DocumentRecord | null>("import_pdf");
}

export function listShelves(): Promise<NamedRecord[]> {
  return invoke<NamedRecord[]>("list_shelves");
}

export function createShelf(name: string): Promise<NamedRecord> {
  return invoke<NamedRecord>("create_shelf", { name });
}

export function updateShelf(id: number, name: string): Promise<NamedRecord> {
  return invoke<NamedRecord>("update_shelf", { id, name });
}

export function deleteShelf(id: number): Promise<void> {
  return invoke("delete_shelf", { id });
}

export function listTags(): Promise<NamedRecord[]> {
  return invoke<NamedRecord[]>("list_tags");
}

export function createTag(name: string): Promise<NamedRecord> {
  return invoke<NamedRecord>("create_tag", { name });
}

export function updateTag(id: number, name: string): Promise<NamedRecord> {
  return invoke<NamedRecord>("update_tag", { id, name });
}

export function deleteTag(id: number): Promise<void> {
  return invoke("delete_tag", { id });
}

export type WorkerResponse = {
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

export type TextBlock = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageAnalysis = {
  pageNumber: number;
  pageWidth?: number;
  pageHeight?: number;
  hasTextLayer: boolean;
  blocks: TextBlock[];
};

export type OcrBlock = {
  text: string;
  confidence?: number;
};

export type OcrResult = {
  text: string;
  blocks: OcrBlock[];
};

export type TranslationResult = {
  translatedText: string;
  translator?: string;
};

export function translateText(
  text: string,
  sourceLanguage = "en",
  targetLanguage = "ru",
): Promise<WorkerResponse> {
  return invoke<WorkerResponse>("translate_text", {
    text,
    sourceLanguage,
    targetLanguage,
  });
}

export type PageOcrBlock = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
};

export function ocrDocumentPage(documentId: number, pageNumber: number): Promise<WorkerResponse> {
  return invoke<WorkerResponse>("ocr_document_page", {
    id: documentId,
    pageNumber,
  });
}

export function ocrDocumentRegion(
  documentId: number,
  pageNumber: number,
  rect: { x: number; y: number; width: number; height: number },
): Promise<WorkerResponse> {
  return invoke<WorkerResponse>("ocr_document_region", {
    id: documentId,
    pageNumber,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

export function analyzeDocumentPage(
  documentId: number,
  pageNumber: number,
): Promise<WorkerResponse> {
  return invoke<WorkerResponse>("analyze_document_page", {
    id: documentId,
    pageNumber,
  });
}

export function errorText(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Не удалось выполнить операцию";
}

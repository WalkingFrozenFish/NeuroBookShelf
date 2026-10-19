CREATE TABLE translation_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    source_x REAL NOT NULL,
    source_y REAL NOT NULL,
    source_width REAL NOT NULL,
    source_height REAL NOT NULL,
    ocr_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (source_x >= 0 AND source_y >= 0),
    CHECK (source_width > 0 AND source_height > 0),
    CHECK (source_x + source_width <= 1.001),
    CHECK (source_y + source_height <= 1.001)
);

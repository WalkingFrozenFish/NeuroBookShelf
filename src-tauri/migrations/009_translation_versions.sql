CREATE TABLE translation_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    translation_block_id INTEGER NOT NULL REFERENCES translation_blocks (id) ON DELETE CASCADE,
    translated_text TEXT NOT NULL,
    translator TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
);

CREATE UNIQUE INDEX translation_versions_one_active
ON translation_versions (translation_block_id)
WHERE is_active = 1;

INSERT INTO translation_versions (translation_block_id, translated_text, translator, created_at, is_active)
SELECT id, translated_text, 'legacy', created_at, 1
FROM translation_blocks
WHERE trim(translated_text) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM translation_versions
      WHERE translation_block_id = translation_blocks.id
  );

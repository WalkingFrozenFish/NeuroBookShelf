ALTER TABLE documents ADD COLUMN original_filename TEXT;
ALTER TABLE documents ADD COLUMN internal_filename TEXT;
ALTER TABLE documents ADD COLUMN path TEXT;
ALTER TABLE documents ADD COLUMN file_size INTEGER;
ALTER TABLE documents ADD COLUMN hash TEXT;

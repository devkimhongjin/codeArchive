-- No synthetic backfill: existing rows remain unknown until site metadata is verified.
ALTER TABLE solutions ADD COLUMN difficulty_label VARCHAR(10);
ALTER TABLE solutions ADD COLUMN difficulty_source_url VARCHAR(2048);

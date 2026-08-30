ALTER TABLE sync_profiles ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sync_chunks (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision, chunk_index)
);

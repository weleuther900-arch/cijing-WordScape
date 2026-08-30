CREATE TABLE IF NOT EXISTS sync_profiles (
  profile_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_chunks (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision, chunk_index)
);

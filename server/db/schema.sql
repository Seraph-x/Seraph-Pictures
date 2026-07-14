PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS storage_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_configs_type ON storage_configs(type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_storage_default_per_type
ON storage_configs(type) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS storage_write_references (
  operation_id TEXT PRIMARY KEY,
  storage_config_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(storage_config_id) REFERENCES storage_configs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_storage_write_references_profile
ON storage_write_references(storage_config_id);

CREATE TABLE IF NOT EXISTS storage_migration_lock (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  owner TEXT NOT NULL,
  token TEXT NOT NULL,
  acquired_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  storage_config_id TEXT NOT NULL,
  storage_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  folder_path TEXT NOT NULL DEFAULT '',
  list_type TEXT NOT NULL DEFAULT 'None',
  label TEXT NOT NULL DEFAULT 'None',
  liked INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL,
  upload_source TEXT NOT NULL,
  access_version INTEGER NOT NULL,
  expires_at INTEGER,
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(storage_config_id) REFERENCES storage_configs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_storage_type ON files(storage_type);
CREATE INDEX IF NOT EXISTS idx_files_list_type ON files(list_type);

CREATE TABLE IF NOT EXISTS private_shares (
  share_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  access_version INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  max_downloads INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_private_shares_expiry ON private_shares(expires_at);

CREATE TABLE IF NOT EXISTS share_range_leases (
  lease_id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  next_offset INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(share_id) REFERENCES private_shares(share_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_share_range_leases_expiry
ON share_range_leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_share_range_leases_share
ON share_range_leases(share_id);

CREATE TABLE IF NOT EXISTS virtual_folders (
  path TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_virtual_folders_updated_at ON virtual_folders(updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_failures_expires ON login_failures(window_expires_at);

CREATE TABLE IF NOT EXISTS chunk_uploads (
  upload_id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT,
  total_chunks INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL DEFAULT 0,
  received_bytes INTEGER NOT NULL DEFAULT 0,
  storage_mode TEXT,
  storage_config_id TEXT,
  upload_source TEXT NOT NULL DEFAULT 'image-host',
  visibility TEXT NOT NULL DEFAULT 'public',
  folder_path TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(storage_config_id) REFERENCES storage_configs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_chunk_uploads_expires_at ON chunk_uploads(expires_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at ON app_settings(updated_at DESC);

-- Additive only: legacy memory_usage is intentionally retained because its unit is unknown.
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS memory_value NUMERIC(19,6);
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS memory_unit VARCHAR(10);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 0,
  display_name VARCHAR(255), nickname VARCHAR(80),
  copy_header BOOLEAN NOT NULL DEFAULT FALSE, download_header BOOLEAN NOT NULL DEFAULT FALSE,
  download_filename_template VARCHAR(160) NOT NULL DEFAULT '{platform}-{number}-{title}',
  git_path_template VARCHAR(240) NOT NULL DEFAULT '{platform}/{number}-{title}',
  light_theme VARCHAR(64) NOT NULL DEFAULT 'github-light', dark_theme VARCHAR(64) NOT NULL DEFAULT 'github-dark',
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE, github_auto_commit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  github_installation_id BIGINT, github_owner VARCHAR(100), github_repository VARCHAR(100), github_branch VARCHAR(255), github_root_path VARCHAR(240),
  automation_enabled_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS relay_grants (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE, device_id VARCHAR(100) NOT NULL, generation BIGINT NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE, expires_at TIMESTAMP WITH TIME ZONE NOT NULL, created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS github_commit_jobs (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, capture_id VARCHAR(36) NOT NULL,
  settings_generation BIGINT NOT NULL, state VARCHAR(16) NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL, updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  UNIQUE(user_id, capture_id)
);

CREATE INDEX IF NOT EXISTS idx_relay_grants_user_device_active ON relay_grants(user_id, device_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_github_commit_jobs_state_created ON github_commit_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_github_commit_jobs_state_updated ON github_commit_jobs(state, updated_at);

-- Durable at-most-once ledger. No source, provider response, credentials or session token is stored.
-- Session/solution IDs deliberately do not cascade: deletion must not erase a dispatch tombstone.
CREATE TABLE github_upload_intents (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    operation_hash CHAR(64) NOT NULL,
    review JSONB NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'READY'
        CHECK (status IN ('READY', 'ATTEMPTED', 'SUCCEEDED', 'REJECTED', 'UNKNOWN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    attempted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    commit_sha CHAR(40),
    commit_url VARCHAR(512),
    error_code VARCHAR(64),
    CHECK ((status = 'SUCCEEDED') = (commit_sha IS NOT NULL AND commit_url IS NOT NULL))
);
-- Different intent IDs, sessions, source versions or messages cannot repeat a possibly dispatched target.
CREATE UNIQUE INDEX github_upload_once_per_target ON github_upload_intents(user_id, operation_hash)
    WHERE status IN ('ATTEMPTED', 'SUCCEEDED', 'UNKNOWN');
CREATE INDEX github_upload_intents_owner ON github_upload_intents(user_id, created_at DESC);

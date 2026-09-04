-- Slice 1: durable closed-Dashboard relay and server-owned automation foundation.
-- Secrets, source text and provider responses are never persisted in these tables.

ALTER TABLE solutions
    ADD COLUMN capture_generation BIGINT,
    ADD COLUMN captured_at TIMESTAMPTZ;

ALTER TABLE solutions
    ADD CONSTRAINT chk_solutions_capture_generation
        CHECK (capture_generation IS NULL OR capture_generation >= 0);

CREATE INDEX idx_solutions_durable_capture
    ON solutions(user_id, capture_generation, captured_at, id)
    WHERE accepted_capture = TRUE AND result = 'ACCEPTED';

CREATE TABLE automation_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(128),
    generation BIGINT NOT NULL DEFAULT 0,
    source_transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    github_auto_commit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ownership_mode VARCHAR(16) NOT NULL DEFAULT 'PAGE_OWNED',
    target_generation BIGINT NOT NULL DEFAULT 0,
    target JSONB,
    automatic_transfer_consent BOOLEAN NOT NULL DEFAULT FALSE,
    visibility_risk_consent BOOLEAN NOT NULL DEFAULT FALSE,
    public_upload_consent BOOLEAN NOT NULL DEFAULT FALSE,
    github_enabled_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT chk_automation_profile_generation CHECK (generation >= 0),
    CONSTRAINT chk_automation_profile_target_generation CHECK (target_generation >= 0),
    CONSTRAINT chk_automation_profile_version CHECK (version >= 0),
    CONSTRAINT chk_automation_profile_ownership
        CHECK (ownership_mode IN ('PAGE_OWNED', 'DURABLE_SERVER'))
);

CREATE TABLE relay_pairing_challenges (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    public_key TEXT NOT NULL,
    challenge_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    consumed_at TIMESTAMPTZ
);
CREATE INDEX relay_pairing_challenges_owner
    ON relay_pairing_challenges(user_id, device_id, expires_at);

CREATE TABLE relay_grants (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(128) NOT NULL,
    generation BIGINT NOT NULL,
    public_key_hash CHAR(64) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT chk_relay_grant_generation CHECK (generation >= 0)
);
CREATE INDEX relay_grants_active_owner
    ON relay_grants(user_id, device_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE durable_github_attempts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    solution_id UUID NOT NULL,
    profile_generation BIGINT NOT NULL,
    target_generation BIGINT NOT NULL,
    state VARCHAR(16) NOT NULL,
    claim_token CHAR(64) NOT NULL UNIQUE,
    lease_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    completed_at TIMESTAMPTZ,
    commit_sha CHAR(40),
    commit_url VARCHAR(2048),
    error_code VARCHAR(80),

    CONSTRAINT uq_durable_attempt_user_solution UNIQUE (user_id, solution_id),
    CONSTRAINT chk_durable_attempt_state
        CHECK (state IN ('CLAIMED', 'ATTEMPTED', 'SUCCEEDED', 'REJECTED', 'UNKNOWN')),
    CONSTRAINT chk_durable_attempt_generation CHECK (profile_generation >= 0 AND target_generation >= 0),
    CONSTRAINT chk_durable_attempt_success
        CHECK ((state = 'SUCCEEDED') = (commit_sha IS NOT NULL AND commit_url IS NOT NULL))
);
CREATE UNIQUE INDEX uq_durable_attempt_active_user
    ON durable_github_attempts(user_id)
    WHERE state = 'CLAIMED';
CREATE INDEX durable_attempts_recovery
    ON durable_github_attempts(user_id, state, lease_until);

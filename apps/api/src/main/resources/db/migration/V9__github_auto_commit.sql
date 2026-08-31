-- Page/session-scoped opt-in. No scheduler, tokens, source text or historical backfill.
CREATE TABLE github_auto_runs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    state VARCHAR(16) NOT NULL CHECK (state IN ('STARTING','ACTIVE','OFF','PAUSED')),
    target JSONB,
    enabled_at TIMESTAMPTZ,
    lease_until TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + interval '60 seconds',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    error_code VARCHAR(80)
);
CREATE UNIQUE INDEX uq_github_auto_active ON github_auto_runs(user_id) WHERE state IN ('STARTING','ACTIVE');
CREATE INDEX idx_github_auto_owner ON github_auto_runs(user_id, created_at DESC);
CREATE TABLE github_auto_attempts (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES github_auto_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    solution_id UUID NOT NULL,
    state VARCHAR(16) NOT NULL CHECK (state IN ('ATTEMPTED','SUCCEEDED','REJECTED','UNKNOWN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    commit_sha CHAR(40),
    commit_url VARCHAR(2048),
    error_code VARCHAR(80),
    UNIQUE(user_id, solution_id),
    CHECK ((state='SUCCEEDED') = (commit_sha IS NOT NULL AND commit_url IS NOT NULL))
);
CREATE UNIQUE INDEX uq_github_auto_inflight ON github_auto_attempts(run_id) WHERE state='ATTEMPTED';

CREATE TABLE solutions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_record_id VARCHAR(128) NOT NULL,
    platform VARCHAR(32) NOT NULL,
    problem_number VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    language VARCHAR(64) NOT NULL,
    code TEXT NOT NULL,
    result VARCHAR(32) NOT NULL,
    solved_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ,
    execution_time VARCHAR(128),
    memory_usage VARCHAR(128),
    ai_usage VARCHAR(16) NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT uq_solutions_user_client_record
        UNIQUE (user_id, client_record_id),
    CONSTRAINT chk_solutions_ai_usage
        CHECK (ai_usage IN ('used', 'not_used', 'unknown'))
);

CREATE INDEX idx_solutions_user_observed_created
    ON solutions(user_id, observed_at DESC, created_at DESC);

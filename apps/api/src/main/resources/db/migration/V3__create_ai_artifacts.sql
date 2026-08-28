CREATE TABLE ai_artifacts (
    id UUID PRIMARY KEY,
    solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT chk_ai_artifacts_type
        CHECK (type IN ('APPROACH_DESIGN', 'COMMENTED_CODE', 'CODE_REVIEW'))
);

CREATE INDEX idx_ai_artifacts_solution_created
    ON ai_artifacts(solution_id, created_at DESC);

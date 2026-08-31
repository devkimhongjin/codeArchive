-- No legacy backfill: an editable ACCEPTED value is not capture provenance.
ALTER TABLE solutions ADD COLUMN accepted_capture BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE solutions ADD COLUMN community_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE solutions ADD COLUMN published_at TIMESTAMPTZ;
ALTER TABLE solutions ADD CONSTRAINT community_requires_capture CHECK
    (NOT community_public OR (accepted_capture AND result = 'ACCEPTED' AND published_at IS NOT NULL));
CREATE INDEX idx_solutions_community_problem ON solutions(platform, problem_number, published_at DESC, id)
    WHERE community_public AND accepted_capture AND result = 'ACCEPTED';

-- All write paths, including legacy upsert, invalidate edited capture evidence.
CREATE FUNCTION invalidate_edited_capture() RETURNS TRIGGER AS $$
BEGIN
    IF ROW(OLD.platform, OLD.problem_number, OLD.language, OLD.code, OLD.result)
       IS DISTINCT FROM ROW(NEW.platform, NEW.problem_number, NEW.language, NEW.code, NEW.result) THEN
        NEW.accepted_capture := FALSE;
        NEW.community_public := FALSE;
        NEW.published_at := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER solutions_invalidate_capture BEFORE UPDATE ON solutions
    FOR EACH ROW EXECUTE FUNCTION invalidate_edited_capture();

CREATE TABLE community_comments (
    id UUID PRIMARY KEY,
    solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_community_comments_page ON community_comments(solution_id, created_at, id);
CREATE TABLE community_likes (
    solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(solution_id, user_id)
);
CREATE TABLE community_rate_windows (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL,
    PRIMARY KEY(user_id, action)
);
CREATE TABLE community_reports (
    solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(16) NOT NULL CHECK (reason IN ('SPAM', 'ABUSE', 'SENSITIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(solution_id, user_id)
);

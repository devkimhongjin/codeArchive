ALTER TABLE solutions ADD COLUMN published_at TIMESTAMP(6) WITH TIME ZONE;

CREATE INDEX idx_solutions_community_problem
    ON solutions (platform, problem_number, published_at DESC, id DESC)
    WHERE published_at IS NOT NULL;

CREATE INDEX idx_solutions_community_owner
    ON solutions (user_id, platform, problem_number)
    WHERE published_at IS NOT NULL;

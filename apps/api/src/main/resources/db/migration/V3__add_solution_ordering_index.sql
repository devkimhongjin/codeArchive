CREATE INDEX IF NOT EXISTS idx_solutions_user_solved_at
    ON solutions (user_id, solved_at DESC);

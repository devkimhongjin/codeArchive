ALTER TABLE solutions
    ADD COLUMN historical_submission_id VARCHAR(40);

CREATE UNIQUE INDEX uk_solution_user_historical_submission
    ON solutions (user_id, platform, historical_submission_id)
    WHERE historical_submission_id IS NOT NULL;

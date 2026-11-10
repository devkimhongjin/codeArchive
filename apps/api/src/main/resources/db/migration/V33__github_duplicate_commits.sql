-- Automatic commits of a problem accepted again in the same language. Existing
-- accounts keep committing every accepted submission.
ALTER TABLE user_settings ADD COLUMN github_duplicate_commits VARCHAR(20) NOT NULL DEFAULT 'ALL';
ALTER TABLE user_settings ADD CONSTRAINT ck_github_duplicate_commits CHECK (github_duplicate_commits IN ('ALL', 'FIRST_ACCEPTED'));

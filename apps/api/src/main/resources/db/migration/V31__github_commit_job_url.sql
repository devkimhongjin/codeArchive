-- The github.com page of the file a confirmed commit wrote, so the extension can link to it.
ALTER TABLE github_commit_jobs ADD COLUMN github_url VARCHAR(2048);

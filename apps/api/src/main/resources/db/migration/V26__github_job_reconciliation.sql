-- Legacy UNKNOWN jobs intentionally receive no inferred recovery context.
ALTER TABLE github_commit_jobs ADD COLUMN recovery_context VARCHAR(64);
ALTER TABLE github_commit_jobs ADD COLUMN diagnostic VARCHAR(40);

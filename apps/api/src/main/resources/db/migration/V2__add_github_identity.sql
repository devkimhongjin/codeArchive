ALTER TABLE users
    ADD COLUMN github_id VARCHAR(64),
    ADD COLUMN github_login VARCHAR(39),
    ADD COLUMN github_name VARCHAR(255),
    ADD COLUMN github_email VARCHAR(320);

ALTER TABLE users
    ALTER COLUMN email DROP NOT NULL,
    ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
    ADD CONSTRAINT uk_users_github_id UNIQUE (github_id);

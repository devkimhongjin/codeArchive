ALTER TABLE user_settings
    ADD COLUMN github_commit_message_template VARCHAR(200) NOT NULL
    DEFAULT 'Add {platform} {number} solution';

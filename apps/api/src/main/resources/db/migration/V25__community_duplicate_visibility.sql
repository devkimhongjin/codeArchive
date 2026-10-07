ALTER TABLE user_settings ADD COLUMN community_duplicate_visibility VARCHAR(20) NOT NULL DEFAULT 'all';
ALTER TABLE user_settings ADD CONSTRAINT ck_community_duplicate_visibility
    CHECK (community_duplicate_visibility IN ('all', 'execution', 'memory', 'length'));

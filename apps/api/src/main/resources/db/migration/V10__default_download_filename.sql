-- Apply only to newly inserted settings. Existing user choices stay untouched.
ALTER TABLE user_settings
    ALTER COLUMN download_filename_template SET DEFAULT 'Solution_{number}_{name}';

ALTER TABLE desktop_login_requests ADD COLUMN callback_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE desktop_login_requests ADD COLUMN callback_code_hash VARCHAR(64);

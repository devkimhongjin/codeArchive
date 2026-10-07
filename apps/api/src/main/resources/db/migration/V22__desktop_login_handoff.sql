CREATE TABLE desktop_login_lock (id INTEGER PRIMARY KEY);
INSERT INTO desktop_login_lock (id) VALUES (1);
CREATE TABLE desktop_login_requests (
    id VARCHAR(64) PRIMARY KEY,
    challenge VARCHAR(43) NOT NULL,
    client_key VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    bound BOOLEAN NOT NULL DEFAULT FALSE,
    github_id VARCHAR(64)
);
CREATE INDEX idx_desktop_login_expiry ON desktop_login_requests (expires_at);

CREATE TABLE community_request_limits (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    window_start TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    read_count INTEGER NOT NULL DEFAULT 0,
    write_count INTEGER NOT NULL DEFAULT 0
);

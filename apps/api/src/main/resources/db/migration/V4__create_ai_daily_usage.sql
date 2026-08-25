CREATE TABLE ai_daily_usage (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,
    request_count INTEGER NOT NULL,

    CONSTRAINT pk_ai_daily_usage
        PRIMARY KEY (user_id, usage_date),
    CONSTRAINT chk_ai_daily_usage_request_count
        CHECK (request_count >= 0)
);

CREATE TABLE users (
    id UUID PRIMARY KEY,
    github_user_id BIGINT NOT NULL UNIQUE,
    github_login VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    avatar_url VARCHAR(2048),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_auth_sessions_user_id
    ON auth_sessions(user_id);

CREATE TABLE oauth_states (
    id UUID PRIMARY KEY,
    state_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE TABLE auth_exchange_codes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX idx_auth_exchange_codes_user_id
    ON auth_exchange_codes(user_id);

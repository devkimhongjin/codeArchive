ALTER TABLE oauth_states
    ADD COLUMN flow_type VARCHAR(16) NOT NULL DEFAULT 'GENERIC';

ALTER TABLE oauth_states
    ADD CONSTRAINT chk_oauth_states_flow_type
        CHECK (flow_type IN ('GENERIC', 'EXTENSION'));

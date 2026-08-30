ALTER TABLE oauth_states
    DROP CONSTRAINT chk_oauth_states_flow_type;

ALTER TABLE oauth_states
    ADD CONSTRAINT chk_oauth_states_flow_type
        CHECK (flow_type IN ('GENERIC', 'EXTENSION', 'DASHBOARD'));

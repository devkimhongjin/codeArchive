-- Versioned disclosure for prospective relay-imported community visibility.
-- Existing rows remain unchanged; no data backfill is authorized.
ALTER TABLE automation_profiles
    ADD COLUMN community_default_public_policy_version VARCHAR(64),
    ADD COLUMN community_default_public_consented_at TIMESTAMPTZ,
    ADD COLUMN community_default_public_auth_session_id UUID REFERENCES auth_sessions(id),
    ADD COLUMN community_default_public_generation BIGINT;

ALTER TABLE automation_profiles
    ADD CONSTRAINT chk_automation_profile_community_public_generation
        CHECK (community_default_public_generation IS NULL OR community_default_public_generation >= 0);

CREATE INDEX automation_profiles_community_public_consent
    ON automation_profiles(community_default_public_auth_session_id, community_default_public_generation)
    WHERE community_default_public_policy_version IS NOT NULL;

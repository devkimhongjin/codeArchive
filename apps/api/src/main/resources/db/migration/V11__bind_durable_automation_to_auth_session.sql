-- Bind server-owned relay and worker authority to the Dashboard AuthSession.
-- Existing rows predate this binding and therefore fail closed during rollout.

ALTER TABLE automation_profiles
    ADD COLUMN auth_session_id UUID REFERENCES auth_sessions(id);

ALTER TABLE relay_grants
    ADD COLUMN auth_session_id UUID REFERENCES auth_sessions(id);

CREATE INDEX automation_profiles_auth_session
    ON automation_profiles(auth_session_id)
    WHERE auth_session_id IS NOT NULL;

CREATE INDEX relay_grants_auth_session_active
    ON relay_grants(auth_session_id, expires_at)
    WHERE revoked_at IS NULL;

-- Legacy relay credentials have no trustworthy session binding.
UPDATE relay_grants
SET revoked_at = COALESCE(revoked_at, clock_timestamp())
WHERE revoked_at IS NULL;

-- Legacy durable profiles have no trustworthy authorization session. Fence the
-- generation and clear all authority/target/consent state; no authority is
-- inferred from the old rows.
UPDATE automation_profiles
SET generation = generation + 1,
    source_transfer_enabled = FALSE,
    github_auto_commit_enabled = FALSE,
    ownership_mode = 'PAGE_OWNED',
    target = NULL,
    automatic_transfer_consent = FALSE,
    visibility_risk_consent = FALSE,
    public_upload_consent = FALSE,
    github_enabled_at = NULL,
    auth_session_id = NULL,
    version = version + 1,
    updated_at = clock_timestamp()
WHERE source_transfer_enabled = TRUE
   OR github_auto_commit_enabled = TRUE
   OR ownership_mode = 'DURABLE_SERVER';

UPDATE github_auto_runs
SET state = 'OFF', error_code = 'AUTOMATION_OWNERSHIP_CONFLICT'
WHERE state IN ('STARTING', 'ACTIVE');

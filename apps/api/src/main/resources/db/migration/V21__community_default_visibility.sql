-- This preference applies only when creating a new solution. Existing solution
-- visibility stays unchanged; bulk publication requires an account-owned action.
ALTER TABLE user_settings ADD COLUMN community_public_by_default BOOLEAN NOT NULL DEFAULT TRUE;

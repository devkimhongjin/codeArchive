-- Programmers uses an account/lesson/exact timestamp/language identity.
ALTER TABLE solutions ALTER COLUMN historical_submission_id TYPE VARCHAR(320);

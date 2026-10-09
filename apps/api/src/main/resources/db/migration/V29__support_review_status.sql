-- Add an active review state without rewriting or removing existing inquiry data.
-- CLOSED remains allowed only for existing rows/rollback compatibility.
ALTER TABLE support_inquiries DROP CONSTRAINT ck_support_inquiries_status;
ALTER TABLE support_inquiries ADD CONSTRAINT ck_support_inquiries_status
    CHECK (status IN ('OPEN', 'IN_REVIEW', 'ANSWERED', 'CLOSED'));

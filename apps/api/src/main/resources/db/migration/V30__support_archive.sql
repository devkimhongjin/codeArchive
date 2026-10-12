-- Archive only hides completed support records from the administrator's active queue.
-- Owner history and messages remain intact.
ALTER TABLE support_inquiries ADD COLUMN archived_at TIMESTAMP(6) WITH TIME ZONE;
CREATE INDEX idx_support_inquiries_active_updated ON support_inquiries(archived_at, updated_at DESC, id DESC);

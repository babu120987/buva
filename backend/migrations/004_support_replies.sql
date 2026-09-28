ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS customer_reply TEXT;

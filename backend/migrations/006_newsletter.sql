CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT newsletter_email_normalized CHECK (email = lower(trim(email)))
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriptions_email_key
  ON newsletter_subscriptions (email);

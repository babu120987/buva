CREATE TABLE IF NOT EXISTS product_views (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS product_views_recent_idx
  ON product_views(customer_id, viewed_at DESC);

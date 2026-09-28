CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  billing_address JSONB NOT NULL,
  subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise >= 0),
  discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  shipping_paise INTEGER NOT NULL DEFAULT 0 CHECK (shipping_paise >= 0),
  taxable_paise INTEGER NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_tax_paise INTEGER NOT NULL CHECK (total_tax_paise >= 0),
  total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_tax_total_check CHECK (cgst_paise + sgst_paise + igst_paise = total_tax_paise),
  CONSTRAINT invoices_invoice_total_check CHECK (taxable_paise + total_tax_paise = total_paise)
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_issued
  ON invoices(customer_id, issued_at DESC);

WITH source AS (
  SELECT o.*,
    ROUND(o.total_paise * 18.0 / 118.0)::INTEGER AS tax_paise,
    LOWER(COALESCE(o.shipping_address->>'state', '')) = 'tamil nadu' AS intrastate
  FROM orders o
  LEFT JOIN invoices i ON i.order_id = o.id
  WHERE o.customer_id IS NOT NULL AND i.id IS NULL
)
INSERT INTO invoices (
  invoice_number, order_id, customer_id, customer_name, email, phone,
  billing_address, subtotal_paise, discount_paise, shipping_paise,
  taxable_paise, cgst_paise, sgst_paise, igst_paise, total_tax_paise,
  total_paise, currency, issued_at
)
SELECT
  'INV-' || SUBSTRING(order_number FROM 6), id, customer_id, customer_name, email, phone,
  shipping_address, subtotal_paise, discount_paise, shipping_paise,
  total_paise - tax_paise,
  CASE WHEN intrastate THEN tax_paise / 2 ELSE 0 END,
  CASE WHEN intrastate THEN tax_paise - tax_paise / 2 ELSE 0 END,
  CASE WHEN intrastate THEN 0 ELSE tax_paise END,
  tax_paise, total_paise, 'INR', created_at
FROM source
ON CONFLICT (order_id) DO NOTHING;

ALTER TABLE invoices ALTER COLUMN customer_id DROP NOT NULL;

WITH source AS (
  SELECT o.*,
    ROUND(o.total_paise * 18.0 / 118.0)::INTEGER AS tax_paise,
    LOWER(COALESCE(o.shipping_address->>'state', '')) = 'tamil nadu' AS intrastate
  FROM orders o
  LEFT JOIN invoices i ON i.order_id = o.id
  WHERE i.id IS NULL
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
ON CONFLICT DO NOTHING;

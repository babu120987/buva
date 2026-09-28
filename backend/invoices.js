const GST_RATE_BASIS_POINTS = 1800;

export const invoiceNumberForOrder = (orderNumber) => {
  const normalized = String(orderNumber || "").trim().toUpperCase();
  if (!/^BUVA-[A-Z0-9-]{8,59}$/.test(normalized)) {
    throw new TypeError("A valid Buva order number is required");
  }
  return `INV-${normalized.slice(5)}`;
};

export const validateInvoiceNumber = (value) => {
  const invoiceNumber = String(value || "").trim().toUpperCase();
  if (!/^INV-[A-Z0-9-]{8,59}$/.test(invoiceNumber)) {
    const error = new Error("Invalid invoice number");
    error.status = 400;
    throw error;
  }
  return invoiceNumber;
};

export const calculateInclusiveTax = (totalPaise, state = "") => {
  if (!Number.isInteger(totalPaise) || totalPaise < 0) {
    throw new TypeError("Invoice total must be a non-negative integer");
  }
  const totalTaxPaise = Math.round(totalPaise * GST_RATE_BASIS_POINTS / (10_000 + GST_RATE_BASIS_POINTS));
  const intrastate = String(state).trim().toLowerCase() === "tamil nadu";
  const cgstPaise = intrastate ? Math.floor(totalTaxPaise / 2) : 0;
  const sgstPaise = intrastate ? totalTaxPaise - cgstPaise : 0;
  return {
    taxablePaise: totalPaise - totalTaxPaise,
    totalTaxPaise,
    cgstPaise,
    sgstPaise,
    igstPaise: intrastate ? 0 : totalTaxPaise,
    taxRatePercent: GST_RATE_BASIS_POINTS / 100
  };
};

export const createInvoiceForOrder = async (client, order) => {
  const taxes = calculateInclusiveTax(order.totalPaise, order.billingAddress?.state);
  const result = await client.query(`
    INSERT INTO invoices (
      invoice_number, order_id, customer_id, customer_name, email, phone,
      billing_address, subtotal_paise, discount_paise, shipping_paise,
      taxable_paise, cgst_paise, sgst_paise, igst_paise, total_tax_paise,
      total_paise, currency, issued_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::JSONB, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, 'INR', $17
    )
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id, invoice_number AS "invoiceNumber"
  `, [
    invoiceNumberForOrder(order.orderNumber), order.id, order.customerId,
    order.customerName, order.email, order.phone, JSON.stringify(order.billingAddress),
    order.subtotalPaise, order.discountPaise, order.shippingPaise,
    taxes.taxablePaise, taxes.cgstPaise, taxes.sgstPaise, taxes.igstPaise,
    taxes.totalTaxPaise, order.totalPaise, order.issuedAt
  ]);
  return result.rows[0] || null;
};

export const listCustomerInvoices = async (client, customerId) => {
  const result = await client.query(`
    SELECT i.invoice_number AS "invoiceNumber", i.issued_at AS "issuedAt",
      i.total_paise AS "totalPaise", i.currency,
      o.order_number AS "orderNumber", o.status AS "orderStatus",
      o.payment_status AS "paymentStatus", o.payment_method AS "paymentMethod"
    FROM invoices i
    JOIN orders o ON o.id = i.order_id
    WHERE i.customer_id = $1
    ORDER BY i.issued_at DESC, i.invoice_number DESC
  `, [customerId]);
  return result.rows;
};

const getInvoiceByFilter = async (client, filter, values) => {
  const invoiceResult = await client.query(`
    SELECT i.id, i.invoice_number AS "invoiceNumber", i.customer_name AS "customerName",
      i.email, i.phone, i.billing_address AS "billingAddress",
      i.subtotal_paise AS "subtotalPaise", i.discount_paise AS "discountPaise",
      i.shipping_paise AS "shippingPaise", i.taxable_paise AS "taxablePaise",
      i.cgst_paise AS "cgstPaise", i.sgst_paise AS "sgstPaise",
      i.igst_paise AS "igstPaise", i.total_tax_paise AS "totalTaxPaise",
      i.total_paise AS "totalPaise", i.currency, i.issued_at AS "issuedAt",
      o.id AS "orderId", o.order_number AS "orderNumber", o.status AS "orderStatus",
      o.payment_method AS "paymentMethod", o.payment_status AS "paymentStatus",
      o.created_at AS "orderCreatedAt", payment.provider AS "paymentProvider",
      payment.provider_order_id AS "providerOrderId",
      payment.provider_payment_id AS "providerPaymentId",
      payment.status AS "providerPaymentStatus", payment.created_at AS "paymentCreatedAt"
    FROM invoices i
    JOIN orders o ON o.id = i.order_id
    LEFT JOIN LATERAL (
      SELECT provider, provider_order_id, provider_payment_id, status, created_at
      FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
    ) payment ON TRUE
    WHERE ${filter}
  `, values);
  if (invoiceResult.rowCount === 0) return null;

  const itemsResult = await client.query(`
    SELECT oi.product_name AS name, oi.sku, oi.unit_price_paise AS "unitPricePaise",
      oi.quantity, oi.line_total_paise AS "lineTotalPaise",
      (oi.line_total_paise - ROUND(oi.line_total_paise * 18.0 / 118.0)::INTEGER) AS "taxablePaise",
      ROUND(oi.line_total_paise * 18.0 / 118.0)::INTEGER AS "taxPaise",
      18 AS "taxRatePercent"
    FROM order_items oi
    WHERE oi.order_id = $1
    ORDER BY oi.id
  `, [invoiceResult.rows[0].orderId]);
  return { ...invoiceResult.rows[0], items: itemsResult.rows };
};

export const getCustomerInvoice = (client, customerId, invoiceNumber) =>
  getInvoiceByFilter(client, "i.customer_id = $1 AND i.invoice_number = $2", [customerId, invoiceNumber]);

export const getAdminInvoice = (client, orderIdentifier) =>
  getInvoiceByFilter(client, "o.id::TEXT = $1 OR o.order_number = $1", [orderIdentifier]);

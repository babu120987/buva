import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";

const baseUrl = process.env.BUVA_TEST_URL || "http://127.0.0.1:19000";
const adminKey = process.env.BUVA_TEST_ADMIN_KEY;
const razorpaySecret = process.env.BUVA_TEST_RAZORPAY_SECRET;
const webhookSecret = process.env.BUVA_TEST_WEBHOOK_SECRET;
const mockPort = Number(process.env.BUVA_TEST_RAZORPAY_PORT || 19001);
assert(adminKey && razorpaySecret && webhookSecret, "Test admin, Razorpay and webhook secrets are required");

const suffix = Date.now().toString(36);
const providerOrders = new Map();
const mock = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method === "POST" && request.url === "/orders") {
    const body = JSON.parse(await new Promise((resolve) => {
      let text = "";
      request.on("data", (chunk) => { text += chunk; });
      request.on("end", () => resolve(text));
    }));
    const id = `order_mock_${suffix}_${providerOrders.size + 1}`;
    providerOrders.set(id, Number(body.amount));
    response.end(JSON.stringify({ id, amount: body.amount, currency: "INR" }));
    return;
  }
  const match = /^\/payments\/pay_mock_([a-z0-9]+)_(\d+)$/.exec(request.url || "");
  if (request.method === "GET" && match) {
    const orderId = `order_mock_${match[1]}_${match[2]}`;
    response.end(JSON.stringify({ id: `pay_mock_${match[1]}_${match[2]}`, order_id: orderId,
      amount: providerOrders.get(orderId), currency: "INR", status: "captured" }));
    return;
  }
  response.statusCode = 404;
  response.end("{}");
});
await new Promise((resolve) => mock.listen(mockPort, "127.0.0.1", resolve));

const request = async (path, { method = "GET", body, admin = false, raw = false, headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: {
    Accept: "application/json",
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(admin ? { "X-Admin-Key": adminKey } : {}), ...headers
  }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  assert(response.ok, `${method} ${path}: ${response.status} ${payload.error || ""}`);
  return payload;
};

try {
  const { product } = await request("/api/admin/products", { method: "POST", admin: true, body: {
    name: `Payment status test ${suffix}`, slug: `payment-status-${suffix}`,
    sku: `PAYMENT-TEST-${suffix.toUpperCase()}`, categorySlug: "woody",
    scentFamily: "woody", concentration: "Parfum", sizeMl: 50,
    pricePaise: 200000, compareAtPricePaise: 220000, quantity: 5, lowStockThreshold: 1,
    shortDescription: "Payment status integration test", description: "Disposable test product.",
    imageUrl: "/perfume.jpg", imageAlt: "Test bottle", active: true, featured: false
  } });

  const placeOrder = async () => {
    const { cart } = await request("/api/carts", { method: "POST", body: {} });
    await request(`/api/carts/${cart.sessionToken}/items`, { method: "POST", body: { productId: product.id, quantity: 1 } });
    const { order, payment } = await request(`/api/carts/${cart.sessionToken}/checkout`, { method: "POST", body: {
      customerName: "Payment Test", email: `payment-${suffix}@example.test`, phone: "9876543210",
      paymentMethod: "razorpay", shippingAddress: {
        recipientName: "Payment Test", line1: "1 Test Street", city: "Chennai", state: "Tamil Nadu",
        postalCode: "600001", countryCode: "IN"
      }
    } });
    assert.equal(order.status, "pending");
    assert.equal(order.paymentStatus, "pending");
    return { order, payment };
  };

  const first = await placeOrder();
  const paymentId = first.payment.providerOrderId.replace(/^order_/, 'pay_');
  const signature = crypto.createHmac("sha256", razorpaySecret)
    .update(`${first.payment.providerOrderId}|${paymentId}`).digest("hex");
  const verified = await request("/api/payments/razorpay/verify", { method: "POST", body: {
    orderId: first.order.id, razorpayPaymentId: paymentId,
    razorpayOrderId: first.payment.providerOrderId, razorpaySignature: signature
  } });
  assert.equal(verified.order.status, "pending");
  assert.equal(verified.order.paymentStatus, "paid");
  const pending = await request(`/api/admin/orders?status=pending&search=${first.order.orderNumber}`, { admin: true });
  assert(pending.orders.some((order) => order.id === first.order.id && order.paymentStatus === "paid"));

  const confirmed = await request(`/api/admin/orders/${first.order.id}/status`, {
    method: "PATCH", admin: true, body: { status: "confirmed" }
  });
  assert.equal(confirmed.order.status, "confirmed");

  const second = await placeOrder();
  const mismatchedCapture = { event: "payment.captured", payload: { payment: { entity: {
    id: second.payment.providerOrderId.replace(/^order_/, 'pay_'),
    order_id: second.payment.providerOrderId, status: "captured",
    amount: second.payment.amountPaise + 1, currency: "INR"
  } } } };
  const mismatchedBody = JSON.stringify(mismatchedCapture);
  await request("/api/payments/razorpay/webhook", { method: "POST", raw: true,
    body: mismatchedBody, headers: {
      "X-Razorpay-Signature": crypto.createHmac("sha256", webhookSecret).update(mismatchedBody).digest("hex"),
      "X-Razorpay-Event-Id": `payment-status-mismatch-${suffix}-${second.order.id}`
    } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const beforeValidCapture = await request(`/api/admin/orders/${second.order.id}`, { admin: true });
  assert.equal(beforeValidCapture.order.paymentStatus, "pending");

  for (const current of [first, second]) {
    const event = { event: "payment.captured", payload: { payment: { entity: {
      id: current.payment.providerOrderId.replace(/^order_/, 'pay_'),
      order_id: current.payment.providerOrderId, status: "captured",
      amount: current.payment.amountPaise, currency: "INR"
    } } } };
    const rawBody = JSON.stringify(event);
    const webhookSignature = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    await request("/api/payments/razorpay/webhook", { method: "POST", raw: true,
      body: rawBody, headers: { "X-Razorpay-Signature": webhookSignature,
        "X-Razorpay-Event-Id": `payment-status-${suffix}-${current.order.id}` } });
  }

  const waitFor = async (orderId, expected) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { order } = await request(`/api/admin/orders/${orderId}`, { admin: true });
      if (order.status === expected && order.paymentStatus === "paid") return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Order ${orderId} did not become paid and ${expected}`);
  };
  await waitFor(first.order.id, "confirmed");
  await waitFor(second.order.id, "pending");
  console.log(JSON.stringify({ ok: true, checks: ["payment verification stays pending",
    "paid order appears in pending admin list", "admin confirmation", "webhook preserves admin confirmation",
    "mismatched capture leaves payment pending", "webhook payment stays pending"] }));
} finally {
  await new Promise((resolve) => mock.close(resolve));
}

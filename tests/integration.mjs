import assert from "node:assert/strict";
import { createRequire } from "node:module";

const backendRequire = createRequire(new URL("../backend/package.json", import.meta.url));
const ExcelJS = backendRequire("exceljs");

const baseUrl = process.env.BUVA_TEST_URL || "http://127.0.0.1:18080";
const adminKey = process.env.BUVA_TEST_ADMIN_KEY;
assert(adminKey, "BUVA_TEST_ADMIN_KEY is required");
const runId = Date.now().toString(36);
const phone = `9${String(Date.now()).slice(-9)}`;
const updatedPhone = `8${String(Date.now()).slice(-9)}`;

const request = async (path, { method = "GET", body, token, admin = false } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(admin ? { "X-Admin-Key": adminKey } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  assert(response.ok, `${method} ${path} failed: ${response.status} ${payload?.error || ""}`);
  return { response, payload };
};

const productInput = {
  name: `Integration Rose Oud ${runId}`,
  slug: `integration-rose-oud-${runId}`,
  sku: `TEST-ROSE-OUD-${runId.toUpperCase()}`,
  categorySlug: "woody",
  scentFamily: "woody",
  concentration: "Parfum",
  sizeMl: 50,
  pricePaise: 200000,
  compareAtPricePaise: 220000,
  quantity: 20,
  lowStockThreshold: 3,
  shortDescription: "Rose, oud and amber",
  description: "A warm evening fragrance used by the integration test.",
  imageUrl: "/perfume.jpg",
  imageAlt: "Integration Rose Oud bottle",
  active: true,
  featured: true
};

const { payload: productPayload } = await request("/api/admin/products", {
  method: "POST", body: productInput, admin: true
});
const product = productPayload.product;

await request("/api/admin/banners", {
  method: "POST",
  body: { title: `Integration offer ${runId}`, subtitle: "Test banner", imageUrl: "/perfume.jpg", linkUrl: "service.html", placement: "shop", displayOrder: 1, active: true },
  admin: true
});
const { payload: createdCoupon } = await request("/api/admin/coupons", {
  method: "POST",
  body: { code: `TEST10${runId.toUpperCase()}`, discountType: "percentage", discountValue: 10, minimumOrderPaise: 0, usageLimit: 1, active: true },
  admin: true
});
await request(`/api/admin/coupons/${createdCoupon.coupon.id}`, { method: 'PATCH', admin: true, body: {
  code: createdCoupon.coupon.code, discountType: 'percentage', discountValue: 10,
  minimumOrderPaise: 100000, usageLimit: 1,
  startsAt: new Date(Date.now() - 86400000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(), active: true
} });

const { payload: search } = await request(`/api/products?q=${runId}&sort=price_asc`);
assert.equal(search.products.length, 1);
assert.equal(search.products[0].slug, product.slug);
const { payload: banners } = await request("/api/banners?placement=shop");
assert(banners.banners.some((banner) => banner.title === `Integration offer ${runId}`));

const email = `integration-${Date.now()}@example.test`;
const { payload: registration } = await request("/api/auth/register", {
  method: "POST", body: { fullName: "Integration Customer", email, phone, password: "TestPass123!" }
});
const token = registration.session.token;
const { payload: login } = await request('/api/auth/login', { method: 'POST', body: { identifier: email, password: 'TestPass123!' } });
assert(login.session.token);

await request("/api/account/profile", { method: "PATCH", token, body: { fullName: "Integration Customer Updated", phone: updatedPhone } });
await request("/api/account/addresses", { method: "POST", token, body: {
  label: "Home", recipientName: "Integration Customer", phone: updatedPhone, line1: "1 Test Street",
  city: "Chennai", state: "Tamil Nadu", postalCode: "600001", countryCode: "IN", isDefault: true
} });
await request(`/api/account/wishlist/${product.id}`, { method: "POST", token, body: {} });
await request("/api/account/view-history", { method: "POST", token, body: { productId: product.id } });
const { payload: recommendations } = await request("/api/account/recommendations", { token });
assert(Array.isArray(recommendations.products));
assert(!recommendations.products.some((candidate) => String(candidate.id) === String(product.id)));
await request("/api/account/notification-preferences", { method: "PUT", token, body: { orderUpdates: true, marketing: true } });
const testDeviceToken = `integration-device-${runId}-browser`;
await request("/api/account/notification-devices", { method: "POST", token, body: { token: testDeviceToken } });
await request("/api/account/notification-devices", { method: "DELETE", token, body: { token: testDeviceToken } });
const { payload: submittedSupport } = await request("/api/support", { method: "POST", token, body: { topic: "Test enquiry", message: "This is an integration support request." } });
const newsletterEmail = `newsletter-${runId}@example.test`;
const firstSubscription = await request("/api/newsletter", { method: "POST", body: { email: newsletterEmail } });
const duplicateSubscription = await request("/api/newsletter", { method: "POST", body: { email: newsletterEmail.toUpperCase() } });
assert.equal(firstSubscription.response.status, 201);
assert.equal(duplicateSubscription.response.status, 200);
await request(`/api/admin/support/${submittedSupport.ticket.id}`, { method: "PATCH", admin: true,
  body: { status: "resolved", customerReply: "We have received your question and will help." } });

const { payload: cartPayload } = await request("/api/carts", { method: "POST", body: {} });
const cartToken = cartPayload.cart.sessionToken;
await request(`/api/carts/${cartToken}/items`, { method: "POST", body: { productId: product.id, quantity: 1 } });
const couponCode = `TEST10${runId.toUpperCase()}`;
const { payload: couponValidation } = await request("/api/coupons/validate", { method: "POST", body: { code: couponCode, sessionToken: cartToken } });
assert.equal(couponValidation.coupon.discountPaise, 20000);
const tamperedPreview = await request("/api/coupons/validate", { method: "POST", body: { code: couponCode, sessionToken: cartToken, subtotalPaise: 1 } });
assert.equal(tamperedPreview.payload.coupon.discountPaise, 20000);

const { payload: checkout } = await request(`/api/carts/${cartToken}/checkout`, { method: "POST", token, body: {
  customerName: "Integration Customer Updated", email, phone: updatedPhone, couponCode, paymentMethod: "cod",
  shippingAddress: { recipientName: "Integration Customer Updated", line1: "1 Test Street", city: "Chennai", state: "Tamil Nadu", postalCode: "600001", countryCode: "IN" }
} });
const order = checkout.order;
assert.equal(order.discountPaise, 20000);
assert.equal(order.status, "pending");
const { payload: secondCartPayload } = await request('/api/carts', { method: 'POST', body: {} });
await request(`/api/carts/${secondCartPayload.cart.sessionToken}/items`, { method: 'POST', body: { productId: product.id, quantity: 1 } });
const couponLimitPreview = await fetch(`${baseUrl}/api/coupons/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: couponCode, sessionToken: secondCartPayload.cart.sessionToken }) });
assert.equal(couponLimitPreview.status, 400);
assert.match((await couponLimitPreview.json()).error, /usage limit/i);

for (const status of ["confirmed", "packed", "shipped"]) {
  await request(`/api/admin/orders/${order.id}/status`, { method: "PATCH", body: { status }, admin: true });
}
await request(`/api/admin/orders/${order.id}/tracking`, {
  method: "PATCH", body: { courierName: "Test Courier", trackingNumber: "TRACK-123", trackingUrl: "https://example.test/track/TRACK-123" }, admin: true
});
await request(`/api/admin/orders/${order.id}/status`, { method: "PATCH", body: { status: "delivered" }, admin: true });

const { payload: account } = await request("/api/account", { token });
assert.equal(account.customer.fullName, "Integration Customer Updated");
assert.equal(account.addresses.length, 1);
assert.equal(account.wishlist.length, 1);
assert.equal(String(account.recentlyViewed[0].productId), String(product.id));
assert.equal(account.supportTickets[0].customerReply, "We have received your question and will help.");
assert.equal(account.orders[0].trackingNumber, "TRACK-123");
assert.match(account.orders[0].invoiceNumber, /^INV-/);

const { payload: invoiceList } = await request("/api/invoices", { token });
assert(invoiceList.invoices.some((invoice) => invoice.invoiceNumber === account.orders[0].invoiceNumber));
const { payload: invoiceDetail } = await request(`/api/invoices/${encodeURIComponent(account.orders[0].invoiceNumber)}`, { token });
assert.equal(invoiceDetail.invoice.orderNumber, order.orderNumber);
assert.equal(invoiceDetail.invoice.items[0].name, product.name);
const { payload: adminInvoice } = await request(`/api/admin/orders/${order.id}/invoice`, { admin: true });
assert.equal(adminInvoice.invoice.invoiceNumber, account.orders[0].invoiceNumber);
assert.equal(adminInvoice.invoice.items[0].name, product.name);
const unauthenticatedAdminInvoice = await fetch(`${baseUrl}/api/admin/orders/${order.id}/invoice`);
assert.equal(unauthenticatedAdminInvoice.status, 401);
const unauthenticatedInvoice = await fetch(`${baseUrl}/api/invoices/${encodeURIComponent(account.orders[0].invoiceNumber)}`);
assert.equal(unauthenticatedInvoice.status, 401);

const { payload: guestCart } = await request("/api/carts", { method: "POST", body: {} });
await request(`/api/carts/${guestCart.cart.sessionToken}/items`, { method: "POST", body: { productId: product.id, quantity: 1 } });
const { payload: guestCheckout } = await request(`/api/carts/${guestCart.cart.sessionToken}/checkout`, { method: "POST", body: {
  customerName: "Guest Invoice Test", email: `guest-${runId}@example.test`, phone: "9876543210", paymentMethod: "cod",
  shippingAddress: { recipientName: "Guest Invoice Test", line1: "2 Test Street", city: "Chennai", state: "Tamil Nadu", postalCode: "600001", countryCode: "IN" }
} });
const { payload: guestAdminInvoice } = await request(`/api/admin/orders/${guestCheckout.order.id}/invoice`, { admin: true });
assert.equal(guestAdminInvoice.invoice.orderNumber, guestCheckout.order.orderNumber);
assert.match(guestAdminInvoice.invoice.invoiceNumber, /^INV-/);
const guestCustomerInvoice = await fetch(`${baseUrl}/api/invoices/${encodeURIComponent(guestAdminInvoice.invoice.invoiceNumber)}`, {
  headers: { Authorization: `Bearer ${token}` }
});
assert.equal(guestCustomerInvoice.status, 404);
const secondEmail = `integration-other-${Date.now()}@example.test`;
const { payload: secondRegistration } = await request("/api/auth/register", {
  method: "POST",
  body: { fullName: "Other Integration Customer", email: secondEmail, phone: `7${String(Date.now()).slice(-9)}`, password: "TestPass123!" }
});
const crossAccountInvoice = await fetch(`${baseUrl}/api/invoices/${encodeURIComponent(account.orders[0].invoiceNumber)}`, {
  headers: { Authorization: `Bearer ${secondRegistration.session.token}` }
});
assert.equal(crossAccountInvoice.status, 404);
const { payload: otherAccount } = await request("/api/account", { token: secondRegistration.session.token });
assert.equal(otherAccount.recentlyViewed.length, 0);

await request(`/api/account/orders/${order.id}/reviews`, {
  method: "POST", token, body: { productId: product.id, rating: 5, reviewText: "Excellent integration fragrance." }
});
const duplicateReview = await fetch(`${baseUrl}/api/account/orders/${order.id}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ productId: product.id, rating: 4 }) });
assert.equal(duplicateReview.status, 409);
const otherCustomerReview = await fetch(`${baseUrl}/api/account/orders/${order.id}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secondRegistration.session.token}` }, body: JSON.stringify({ productId: product.id, rating: 4 }) });
assert.equal(otherCustomerReview.status, 404);
const { payload: reviewList } = await request("/api/admin/reviews?status=pending", { admin: true });
const ownReview = reviewList.reviews.find((review) => review.productName === product.name && review.orderNumber === order.orderNumber);
assert(ownReview, "Test order review is missing from moderation queue");
await request(`/api/admin/reviews/${ownReview.id}`, { method: "PATCH", body: { status: "approved" }, admin: true });
const { payload: details } = await request(`/api/products/${product.slug}`);
assert.equal(details.product.averageRating, 5);
assert.equal(details.reviews.length, 1);

const { payload: assistant } = await request("/api/assistant", { method: "POST", body: { question: `Recommend ${runId}` } });
assert(assistant.answer.includes(product.name));
assert(assistant.answer.includes("₹2,000"));
assert.equal(assistant.source, "catalogue");

const exportResponse = await fetch(`${baseUrl}/api/admin/exports/orders.csv`, { headers: { "X-Admin-Key": adminKey } });
assert(exportResponse.ok);
assert((await exportResponse.text()).includes(order.orderNumber));

const excelResponse = await fetch(`${baseUrl}/api/admin/exports/orders.xlsx`, { headers: { "X-Admin-Key": adminKey } });
assert(excelResponse.ok);
assert.match(excelResponse.headers.get("content-type") || "", /spreadsheetml/);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(await excelResponse.arrayBuffer()));
const sheet = workbook.getWorksheet("Orders");
assert(sheet, "Excel order worksheet is missing");
let excelHasOrder = false;
sheet.eachRow((row) => { if (row.values.includes(order.orderNumber)) excelHasOrder = true; });
assert(excelHasOrder, "Excel export omits the test order");

console.log(JSON.stringify({
  ok: true,
  product: product.slug,
  order: order.orderNumber,
  checked: ["search", "banners", "profile", "addresses", "wishlist", "notifications", "support replies", "newsletter duplicates", "coupon preview integrity", "checkout", "orders", "customer invoices", "admin invoices", "guest invoices", "tracking", "reviews", "product history", "recommendations", "assistant catalogue grounding", "csv export", "xlsx export"]
}));

import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || "";

const googleOAuthClient =
  googleClientId && googleClientSecret && googleCallbackUrl
    ? new OAuth2Client(
        googleClientId,
        googleClientSecret,
        googleCallbackUrl
      )
    : null;
const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 9000);
const adminApiKey = process.env.ADMIN_API_KEY || "";
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const razorpayApiBase = process.env.RAZORPAY_API_BASE || "https://api.razorpay.com/v1";
const scryptAsync = promisify(crypto.scrypt);

const pool = new Pool({
  host: process.env.DB_HOST || "database",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "buva",
  user: process.env.DB_USER || "buva",
  password: process.env.DB_PASSWORD || "buva_local",
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

app.disable("x-powered-by");
const localDevelopmentOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

app.use((request, response, next) => {
  const origin = request.get("origin");

  if (origin && localDevelopmentOrigin.test(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Admin-Key"
    );
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS"
    );
  }

  if (request.method === "OPTIONS") {
    return response.sendStatus(204);
  }

  next();
});
app.use(express.json({
  limit: "1mb",
  verify: (request, _response, buffer) => { request.rawBody = buffer; }
}));

const productSelect = `
  SELECT
    p.id,
    p.slug,
    p.sku,
    p.name,
    p.short_description AS "shortDescription",
    p.description,
    p.scent_family AS "scentFamily",
    p.concentration,
    p.size_ml AS "sizeMl",
    p.price_paise AS "pricePaise",
    p.compare_at_price_paise AS "compareAtPricePaise",
    p.featured,
    c.slug AS "categorySlug",
    c.name AS "categoryName",
    COALESCE(i.quantity - i.reserved_quantity, 0) AS "availableQuantity",
    image.image_url AS "imageUrl",
    image.alt_text AS "imageAlt"
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN inventory i ON i.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT image_url, alt_text
    FROM product_images
    WHERE product_id = p.id
    ORDER BY display_order, id
    LIMIT 1
  ) image ON TRUE
`;

const asyncRoute = (handler) => async (request, response, next) => {
  try {
    await handler(request, response);
  } catch (error) {
    next(error);
  }
};

const secureHash = (value) => crypto.createHash("sha256").update(value).digest();

const requireAdmin = (request, response, next) => {
  if (!adminApiKey) {
    return response.status(503).json({ error: "Admin access is not configured" });
  }
  const providedKey = request.get("x-admin-key") || "";
  if (!crypto.timingSafeEqual(secureHash(providedKey), secureHash(adminApiKey))) {
    return response.status(401).json({ error: "Invalid admin access key" });
  }
  next();
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isUuid = (value) => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const parseQuantity = (value, fallback, minimum = 1) => {
  const quantity = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(quantity) || quantity < minimum || quantity > 20) {
    throw new ApiError(400, `Quantity must be an integer between ${minimum} and 20`);
  }
  return quantity;
};

const parseProductId = (value) => {
  const productId = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(productId)) {
    throw new ApiError(400, "A valid productId is required");
  }
  return productId;
};

const parseText = (value, label, { min = 1, max = 200, optional = false } = {}) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (optional && text.length === 0) return null;
  if (text.length < min || text.length > max) {
    throw new ApiError(400, `${label} must be between ${min} and ${max} characters`);
  }
  return text;
};

const parseCheckout = (body = {}) => {
  const customerName = parseText(body.customerName, "Customer name", { min: 2, max: 100 });
  const email = parseText(body.email, "Email", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "A valid email is required");

  const phone = parseText(body.phone, "Phone", { min: 10, max: 20 });
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) throw new ApiError(400, "A valid phone number is required");

  const inputAddress = body.shippingAddress && typeof body.shippingAddress === "object"
    ? body.shippingAddress
    : {};
  const shippingAddress = {
    recipientName: parseText(inputAddress.recipientName || customerName, "Recipient name", { min: 2, max: 100 }),
    line1: parseText(inputAddress.line1, "Address line 1", { min: 3, max: 160 }),
    line2: parseText(inputAddress.line2, "Address line 2", { max: 160, optional: true }),
    city: parseText(inputAddress.city, "City", { min: 2, max: 80 }),
    state: parseText(inputAddress.state, "State", { min: 2, max: 80 }),
    postalCode: parseText(inputAddress.postalCode, "Postal code", { min: 6, max: 6 }),
    countryCode: parseText(inputAddress.countryCode || "IN", "Country code", { min: 2, max: 2 }).toUpperCase()
  };
  if (!/^[1-9][0-9]{5}$/.test(shippingAddress.postalCode)) {
    throw new ApiError(400, "A valid 6-digit Indian postal code is required");
  }
  if (shippingAddress.countryCode !== "IN") throw new ApiError(400, "Delivery is currently available only in India");

  const paymentMethod = body.paymentMethod || "cod";
  if (!["cod", "razorpay"].includes(paymentMethod)) throw new ApiError(400, "Invalid payment method");

  return {
    customerName,
    email,
    phone,
    shippingAddress,
    paymentMethod,
    saveAddress: body.saveAddress === true,
    couponCode: parseText(body.couponCode, "Coupon code", { max: 40, optional: true })?.toUpperCase() || null,
    customerNotes: parseText(body.customerNotes, "Customer notes", { max: 500, optional: true })
  };
};

const parseAccountIdentity = (body = {}) => {
  const fullName = parseText(body.fullName, "Full name", { min: 2, max: 100 });
  const email = parseText(body.email, "Email", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "A valid email is required");
  const phone = parseText(body.phone, "Phone", { min: 10, max: 20 });
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw new ApiError(400, "A valid phone number is required");
  return { fullName, email, phone: digits };
};

const parsePassword = (value) => {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new ApiError(400, "Password must be between 8 and 128 characters");
  }
  return value;
};

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
};

const verifyPassword = async (password, storedHash) => {
  const [algorithm, salt, expectedHex] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !/^[0-9a-f]{128}$/i.test(expectedHex || "")) return false;
  const actual = await scryptAsync(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expectedHex, "hex"));
};

const createCustomerSession = async (customerId, client = pool) => {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const result = await client.query(`
    INSERT INTO customer_sessions (customer_id, token_hash)
    VALUES ($1, $2)
    RETURNING expires_at AS "expiresAt"
  `, [customerId, tokenHash]);
  return { token, expiresAt: result.rows[0].expiresAt };
};

const getCustomerSession = async (request, client = pool, required = false) => {
  const authorization = request.get("authorization") || "";
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(authorization);
  if (!match) {
    if (required || authorization) throw new ApiError(401, "Customer sign-in is required");
    return null;
  }
  const tokenHash = crypto.createHash("sha256").update(match[1]).digest("hex");
  const result = await client.query(`
    SELECT
      s.id AS "sessionId",
      c.id,
      c.email,
      c.phone,
      c.full_name AS "fullName"
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW() AND c.active = TRUE
  `, [tokenHash]);
  if (result.rowCount === 0) throw new ApiError(401, "Customer session is invalid or expired");
  await client.query("UPDATE customer_sessions SET last_used_at = NOW() WHERE id = $1", [result.rows[0].sessionId]);
  return { ...result.rows[0], tokenHash };
};

const parseAddress = (body = {}, defaults = {}) => {
  const postalCode = parseText(body.postalCode, "Postal code", { min: 6, max: 6 });
  if (!/^[1-9][0-9]{5}$/.test(postalCode)) throw new ApiError(400, "A valid 6-digit Indian postal code is required");
  const countryCode = parseText(body.countryCode || "IN", "Country code", { min: 2, max: 2 }).toUpperCase();
  if (countryCode !== "IN") throw new ApiError(400, "Delivery is currently available only in India");
  return {
    label: parseText(body.label || "Home", "Address label", { max: 40 }),
    recipientName: parseText(body.recipientName || defaults.fullName, "Recipient name", { min: 2, max: 100 }),
    phone: parseText(body.phone || defaults.phone, "Phone", { min: 10, max: 20 }),
    line1: parseText(body.line1, "Address line 1", { min: 3, max: 160 }),
    line2: parseText(body.line2, "Address line 2", { max: 160, optional: true }),
    city: parseText(body.city, "City", { min: 2, max: 80 }),
    state: parseText(body.state, "State", { min: 2, max: 80 }),
    postalCode,
    countryCode,
    isDefault: body.isDefault === true
  };
};

const createRazorpayOrder = async ({ amountPaise, receipt, notes }) => {
  if (!razorpayKeyId || !razorpayKeySecret) throw new ApiError(503, "Razorpay is not configured");
  const authorization = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
  const response = await fetch(`${razorpayApiBase}/orders`, {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.id !== "string") {
    console.error("Razorpay order creation failed", response.status, payload.error?.description || "Unknown error");
    throw new ApiError(502, "Unable to start Razorpay payment. Please try again");
  }
  return payload;
};

const fetchRazorpayPayment = async (paymentId) => {
  const authorization = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
  const response = await fetch(`${razorpayApiBase}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Basic ${authorization}`, Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(502, "Unable to confirm Razorpay payment status");
  return payload;
};

const getCart = async (sessionToken, client = pool) => {
  const cartResult = await client.query(`
    SELECT session_token AS "sessionToken", expires_at AS "expiresAt"
    FROM carts
    WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()
  `, [sessionToken]);
  if (cartResult.rowCount === 0) return null;

  const itemsResult = await client.query(`
    SELECT
      p.id AS "productId",
      p.slug,
      p.name,
      p.scent_family AS "scentFamily",
      p.concentration,
      p.size_ml AS "sizeMl",
      p.price_paise AS "pricePaise",
      ci.quantity,
      COALESCE(i.quantity - i.reserved_quantity, 0) AS "availableQuantity",
      image.image_url AS "imageUrl",
      image.alt_text AS "imageAlt"
    FROM carts c
    JOIN cart_items ci ON ci.cart_id = c.id
    JOIN products p ON p.id = ci.product_id
    LEFT JOIN inventory i ON i.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT image_url, alt_text
      FROM product_images
      WHERE product_id = p.id
      ORDER BY display_order, id
      LIMIT 1
    ) image ON TRUE
    WHERE c.session_token = $1
    ORDER BY ci.created_at, p.id
  `, [sessionToken]);

  const items = itemsResult.rows.map((item) => ({
    ...item,
    lineTotalPaise: item.pricePaise * item.quantity
  }));
  const subtotalPaise = items.reduce((total, item) => total + item.lineTotalPaise, 0);
  const deliveryThresholdPaise = 150000;

  return {
    ...cartResult.rows[0],
    items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    subtotalPaise,
    deliveryThresholdPaise,
    qualifiesForFreeDelivery: subtotalPaise >= deliveryThresholdPaise
  };
};

const withTransaction = async (handler) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const lockActiveCart = async (client, sessionToken) => {
  const result = await client.query(`
    SELECT id
    FROM carts
    WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()
    FOR UPDATE
  `, [sessionToken]);
  if (result.rowCount === 0) throw new ApiError(404, "Cart not found or expired");
  return result.rows[0];
};

const getAdminOrder = async (identifier, client = pool) => {
  const orderResult = await client.query(`
    SELECT
      o.id,
      o.order_number AS "orderNumber",
      o.customer_name AS "customerName",
      o.email,
      o.phone,
      o.shipping_address AS "shippingAddress",
      o.subtotal_paise AS "subtotalPaise",
      o.discount_paise AS "discountPaise",
      o.shipping_paise AS "shippingPaise",
      o.total_paise AS "totalPaise",
      o.status,
      o.payment_method AS "paymentMethod",
      o.payment_status AS "paymentStatus",
      o.customer_notes AS "customerNotes",
      o.created_at AS "createdAt",
      o.updated_at AS "updatedAt",
      c.code AS "couponCode"
    FROM orders o
    LEFT JOIN coupons c ON c.id = o.coupon_id
    WHERE o.id::TEXT = $1 OR o.order_number = $1
  `, [identifier]);
  if (orderResult.rowCount === 0) return null;

  const itemsResult = await client.query(`
    SELECT
      product_id AS "productId",
      product_name AS name,
      sku,
      unit_price_paise AS "unitPricePaise",
      quantity,
      line_total_paise AS "lineTotalPaise"
    FROM order_items
    WHERE order_id = $1
    ORDER BY id
  `, [orderResult.rows[0].id]);

  return { ...orderResult.rows[0], items: itemsResult.rows };
};


app.get("/api/auth/google", asyncRoute(async (_request, response) => {
  if (!googleOAuthClient) {
    throw new ApiError(503, "Google sign-in is not configured");
  }

  const url = googleOAuthClient.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account"
  });

  response.redirect(url);
}));

app.get("/api/auth/google/callback", asyncRoute(async (request, response) => {
  if (!googleOAuthClient) {
    throw new ApiError(503, "Google sign-in is not configured");
  }

  const code = parseText(request.query.code, "Google authorization code", {
    min: 1,
    max: 4096
  });

  const { tokens } = await googleOAuthClient.getToken(code);
  if (!tokens.id_token) {
    throw new ApiError(401, "Google did not return an ID token");
  }

  const ticket = await googleOAuthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: googleClientId
  });

  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new ApiError(401, "Google account email could not be verified");
  }

  const googleSubject = payload.sub;
  const email = payload.email.toLowerCase();
  const fullName = String(payload.name || email.split("@")[0]).trim();

  let customer;

  const existingByGoogle = await pool.query(`
    SELECT id, email, phone, full_name AS "fullName", active
    FROM customers
    WHERE google_subject = $1
  `, [googleSubject]);

  if (existingByGoogle.rowCount > 0) {
    customer = existingByGoogle.rows[0];

    if (!customer.active) {
      throw new ApiError(403, "Customer account is inactive");
    }
  } else {
    const existingByEmail = await pool.query(`
      SELECT id, email, phone, full_name AS "fullName", active, google_subject
      FROM customers
      WHERE email = $1
    `, [email]);

    if (existingByEmail.rowCount > 0) {
      customer = existingByEmail.rows[0];

      if (!customer.active) {
        throw new ApiError(403, "Customer account is inactive");
      }

      await pool.query(`
        UPDATE customers
        SET google_subject = $1,
            updated_at = NOW()
        WHERE id = $2
      `, [googleSubject, customer.id]);

      customer.google_subject = googleSubject;
    } else {
      const result = await pool.query(`
        INSERT INTO customers (
          email,
          full_name,
          google_subject,
          password_hash
        )
        VALUES ($1, $2, $3, NULL)
        RETURNING
          id,
          email,
          phone,
          full_name AS "fullName",
          active
      `, [email, fullName, googleSubject]);

      customer = result.rows[0];
    }
  }

  const session = await createCustomerSession(customer.id);

  const frontendUrl = "https://bhuva.duckdns.org";
  const token = encodeURIComponent(session.token);

  response.redirect(`${frontendUrl}/?google_session=${token}`);
}));

app.post("/api/auth/register", asyncRoute(async (request, response) => {
  const identity = parseAccountIdentity(request.body);
  const password = parsePassword(request.body?.password);
  const result = await withTransaction(async (client) => {
    const existing = await client.query(`
      SELECT 1
      FROM customers
      WHERE email = $1 OR REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = $2
    `, [identity.email, identity.phone]);
    if (existing.rowCount) throw new ApiError(409, "An account already exists with this email or phone");
    const passwordHash = await hashPassword(password);
    const customerResult = await client.query(`
      INSERT INTO customers (email, phone, full_name, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, phone, full_name AS "fullName"
    `, [identity.email, identity.phone, identity.fullName, passwordHash]);
    const session = await createCustomerSession(customerResult.rows[0].id, client);
    return { customer: customerResult.rows[0], session };
  });
  response.status(201).json(result);
}));

app.post("/api/auth/login", asyncRoute(async (request, response) => {
  const identifier = parseText(request.body?.identifier || request.body?.email, "Email or phone", { max: 254 });
  const password = parsePassword(request.body?.password);
  const isEmail = identifier.includes("@");
  const email = isEmail ? identifier.toLowerCase() : null;
  const phoneDigits = isEmail ? null : identifier.replace(/\D/g, "");
  if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "A valid email is required");
  if (!isEmail && (phoneDigits.length < 10 || phoneDigits.length > 15)) throw new ApiError(400, "A valid phone number is required");
  const result = await pool.query(`
    SELECT id, email, phone, full_name AS "fullName", password_hash
    FROM customers
    WHERE active = TRUE
      AND (($1::TEXT IS NOT NULL AND email = $1) OR ($2::TEXT IS NOT NULL AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = $2))
  `, [email, phoneDigits]);
  if (result.rowCount === 0 || !await verifyPassword(password, result.rows[0].password_hash)) {
    throw new ApiError(401, "Email/phone or password is incorrect");
  }
  const { password_hash: _passwordHash, ...customer } = result.rows[0];
  const session = await createCustomerSession(customer.id);
  response.json({ customer, session });
}));

app.post("/api/auth/logout", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  await pool.query("DELETE FROM customer_sessions WHERE id = $1", [customer.sessionId]);
  response.status(204).end();
}));

app.get("/api/account", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const [addressesResult, ordersResult] = await Promise.all([
    pool.query(`
      SELECT id, label, recipient_name AS "recipientName", phone, line1, line2,
        city, state, postal_code AS "postalCode", country_code AS "countryCode", is_default AS "isDefault"
      FROM addresses WHERE customer_id = $1
      ORDER BY is_default DESC, created_at DESC
    `, [customer.id]),
    pool.query(`
      SELECT id, order_number AS "orderNumber", total_paise AS "totalPaise", status,
        payment_method AS "paymentMethod", payment_status AS "paymentStatus", created_at AS "createdAt"
      FROM orders WHERE customer_id = $1
      ORDER BY created_at DESC LIMIT 20
    `, [customer.id])
  ]);
  const { sessionId: _sessionId, tokenHash: _tokenHash, ...profile } = customer;
  response.json({ customer: profile, addresses: addressesResult.rows, orders: ordersResult.rows });
}));

app.post("/api/account/addresses", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const address = parseAddress(request.body, customer);
  const created = await withTransaction(async (client) => {
    if (address.isDefault) await client.query("UPDATE addresses SET is_default = FALSE WHERE customer_id = $1", [customer.id]);
    const result = await client.query(`
      INSERT INTO addresses (
        customer_id, label, recipient_name, phone, line1, line2, city, state,
        postal_code, country_code, is_default
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, label, recipient_name AS "recipientName", phone, line1, line2,
        city, state, postal_code AS "postalCode", country_code AS "countryCode", is_default AS "isDefault"
    `, [customer.id, address.label, address.recipientName, address.phone, address.line1,
      address.line2, address.city, address.state, address.postalCode, address.countryCode, address.isDefault]);
    return result.rows[0];
  });
  response.status(201).json({ address: created });
}));

app.get("/api/payments/config", (_request, response) => {
  response.json({ razorpay: { configured: Boolean(razorpayKeyId && razorpayKeySecret), keyId: razorpayKeyId || null } });
});

app.get("/health", async (_request, response) => {
  try {
    const result = await pool.query("SELECT current_database() AS database, NOW() AS checked_at");
    response.json({
      ok: true,
      service: "buva-backend",
      database: result.rows[0].database,
      checkedAt: result.rows[0].checked_at
    });
  } catch (error) {
    console.error("Database health check failed", error.message);
    response.status(503).json({ ok: false, service: "buva-backend", database: "unavailable" });
  }
});

app.get("/api/categories", asyncRoute(async (_request, response) => {
  const result = await pool.query(`
    SELECT
      c.slug,
      c.name,
      c.description,
      COUNT(p.id)::INTEGER AS "productCount"
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.active = TRUE
    WHERE c.active = TRUE
    GROUP BY c.id
    ORDER BY c.display_order, c.name
  `);

  response.json({ categories: result.rows });
}));

app.get("/api/products", asyncRoute(async (request, response) => {
  const family = typeof request.query.family === "string" ? request.query.family.toLowerCase() : null;
  const featured = request.query.featured;
  const requestedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 100;
  const validFamilies = new Set(["floral", "fresh", "woody", "sets"]);

  if (family && !validFamilies.has(family)) {
    return response.status(400).json({ error: "Invalid scent family" });
  }
  if (featured !== undefined && featured !== "true" && featured !== "false") {
    return response.status(400).json({ error: "featured must be true or false" });
  }

  const values = [];
  const filters = ["p.active = TRUE", "c.active = TRUE"];
  if (family) {
    values.push(family);
    filters.push(`p.scent_family = $${values.length}`);
  }
  if (featured !== undefined) {
    values.push(featured === "true");
    filters.push(`p.featured = $${values.length}`);
  }
  values.push(limit);

  const result = await pool.query(`
    ${productSelect}
    WHERE ${filters.join(" AND ")}
    ORDER BY p.featured DESC, p.created_at, p.id
    LIMIT $${values.length}
  `, values);

  response.json({
    products: result.rows,
    meta: { count: result.rowCount, family, featured: featured === undefined ? null : featured === "true" }
  });
}));

app.get("/api/products/:slug", asyncRoute(async (request, response) => {
  const result = await pool.query(`
    ${productSelect}
    WHERE p.slug = $1 AND p.active = TRUE AND c.active = TRUE
  `, [request.params.slug]);

  if (result.rowCount === 0) {
    return response.status(404).json({ error: "Product not found" });
  }

  response.json({ product: result.rows[0] });
}));

app.post("/api/carts", asyncRoute(async (_request, response) => {
  const result = await pool.query(`
    INSERT INTO carts DEFAULT VALUES
    RETURNING session_token AS "sessionToken"
  `);
  const cart = await getCart(result.rows[0].sessionToken);
  response.status(201).json({ cart });
}));

app.get("/api/carts/:sessionToken", asyncRoute(async (request, response) => {
  if (!isUuid(request.params.sessionToken)) throw new ApiError(400, "Invalid cart token");
  const cart = await getCart(request.params.sessionToken);
  if (!cart) throw new ApiError(404, "Cart not found or expired");
  response.json({ cart });
}));

app.post("/api/carts/:sessionToken/items", asyncRoute(async (request, response) => {
  if (!isUuid(request.params.sessionToken)) throw new ApiError(400, "Invalid cart token");
  const productId = parseProductId(request.body.productId);
  const quantity = parseQuantity(request.body.quantity, 1);

  const cart = await withTransaction(async (client) => {
    const activeCart = await lockActiveCart(client, request.params.sessionToken);
    const productResult = await client.query(`
      SELECT p.id, COALESCE(i.quantity - i.reserved_quantity, 0) AS available
      FROM products p
      JOIN inventory i ON i.product_id = p.id
      WHERE p.id = $1 AND p.active = TRUE
      FOR UPDATE OF i
    `, [productId]);
    if (productResult.rowCount === 0) throw new ApiError(404, "Product not found");

    const itemResult = await client.query(
      "SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2",
      [activeCart.id, productId]
    );
    const newQuantity = (itemResult.rows[0]?.quantity || 0) + quantity;
    if (newQuantity > 20) throw new ApiError(400, "A cart item cannot exceed 20 units");
    if (newQuantity > productResult.rows[0].available) {
      throw new ApiError(409, "Requested quantity is not available");
    }

    await client.query(`
      INSERT INTO cart_items (cart_id, product_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (cart_id, product_id)
      DO UPDATE SET quantity = EXCLUDED.quantity
    `, [activeCart.id, productId, newQuantity]);
    return getCart(request.params.sessionToken, client);
  });

  response.json({ cart });
}));

app.patch("/api/carts/:sessionToken/items/:productId", asyncRoute(async (request, response) => {
  if (!isUuid(request.params.sessionToken)) throw new ApiError(400, "Invalid cart token");
  const productId = parseProductId(request.params.productId);
  const quantity = parseQuantity(request.body.quantity, undefined, 0);

  const cart = await withTransaction(async (client) => {
    const activeCart = await lockActiveCart(client, request.params.sessionToken);
    if (quantity === 0) {
      const deleteResult = await client.query(
        "DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2",
        [activeCart.id, productId]
      );
      if (deleteResult.rowCount === 0) throw new ApiError(404, "Cart item not found");
      return getCart(request.params.sessionToken, client);
    }

    const productResult = await client.query(`
      SELECT COALESCE(i.quantity - i.reserved_quantity, 0) AS available
      FROM products p
      JOIN inventory i ON i.product_id = p.id
      WHERE p.id = $1 AND p.active = TRUE
      FOR UPDATE OF i
    `, [productId]);
    if (productResult.rowCount === 0) throw new ApiError(404, "Product not found");
    if (quantity > productResult.rows[0].available) {
      throw new ApiError(409, "Requested quantity is not available");
    }

    const updateResult = await client.query(`
      UPDATE cart_items SET quantity = $3
      WHERE cart_id = $1 AND product_id = $2
    `, [activeCart.id, productId, quantity]);
    if (updateResult.rowCount === 0) throw new ApiError(404, "Cart item not found");
    return getCart(request.params.sessionToken, client);
  });

  response.json({ cart });
}));

app.delete("/api/carts/:sessionToken/items/:productId", asyncRoute(async (request, response) => {
  if (!isUuid(request.params.sessionToken)) throw new ApiError(400, "Invalid cart token");
  const productId = parseProductId(request.params.productId);

  const cart = await withTransaction(async (client) => {
    const activeCart = await lockActiveCart(client, request.params.sessionToken);
    const deleteResult = await client.query(
      "DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2",
      [activeCart.id, productId]
    );
    if (deleteResult.rowCount === 0) throw new ApiError(404, "Cart item not found");
    return getCart(request.params.sessionToken, client);
  });

  response.json({ cart });
}));

app.post("/api/carts/:sessionToken/checkout", asyncRoute(async (request, response) => {
  if (!isUuid(request.params.sessionToken)) throw new ApiError(400, "Invalid cart token");
  const checkout = parseCheckout(request.body);
  const customer = await getCustomerSession(request);
  if (checkout.paymentMethod === "razorpay" && (!razorpayKeyId || !razorpayKeySecret)) {
    throw new ApiError(503, "Razorpay is not configured");
  }

  const result = await withTransaction(async (client) => {
    const activeCart = await lockActiveCart(client, request.params.sessionToken);
    const itemsResult = await client.query(`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        p.price_paise AS unit_price_paise,
        ci.quantity,
        COALESCE(i.quantity - i.reserved_quantity, 0) AS available
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      JOIN inventory i ON i.product_id = p.id
      WHERE ci.cart_id = $1 AND p.active = TRUE
      ORDER BY ci.created_at, p.id
      FOR UPDATE OF i
    `, [activeCart.id]);

    if (itemsResult.rowCount === 0) throw new ApiError(400, "The cart is empty");
    for (const item of itemsResult.rows) {
      if (item.quantity > item.available) {
        throw new ApiError(409, `${item.product_name} no longer has the requested quantity available`);
      }
    }

    const subtotalPaise = itemsResult.rows.reduce(
      (total, item) => total + item.unit_price_paise * item.quantity,
      0
    );
    let couponId = null;
    let discountPaise = 0;
    let couponCode = null;
    if (checkout.couponCode) {
      const couponResult = await client.query(`
        SELECT
          c.id,
          c.code,
          c.discount_type,
          c.discount_value,
          c.minimum_order_paise,
          c.usage_limit,
          (SELECT COUNT(*)::INTEGER FROM orders o WHERE o.coupon_id = c.id AND o.status <> 'cancelled') AS usage_count
        FROM coupons c
        WHERE c.code = $1
          AND c.active = TRUE
          AND (c.starts_at IS NULL OR c.starts_at <= NOW())
          AND (c.ends_at IS NULL OR c.ends_at >= NOW())
        FOR UPDATE OF c
      `, [checkout.couponCode]);
      if (couponResult.rowCount === 0) throw new ApiError(400, "Coupon is invalid or expired");

      const coupon = couponResult.rows[0];
      if (subtotalPaise < coupon.minimum_order_paise) {
        throw new ApiError(400, `Coupon requires a minimum order of ₹${Math.ceil(coupon.minimum_order_paise / 100)}`);
      }
      if (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit) {
        throw new ApiError(400, "Coupon usage limit has been reached");
      }
      discountPaise = coupon.discount_type === "percentage"
        ? Math.floor(subtotalPaise * coupon.discount_value / 100)
        : Math.min(coupon.discount_value, subtotalPaise);
      couponId = coupon.id;
      couponCode = coupon.code;
    }

    const shippingPaise = subtotalPaise >= 150000 ? 0 : 9900;
    const totalPaise = subtotalPaise - discountPaise + shippingPaise;
    const orderNumber = `BUVA-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const razorpayOrder = checkout.paymentMethod === "razorpay"
      ? await createRazorpayOrder({
        amountPaise: totalPaise,
        receipt: orderNumber,
        notes: { buva_order: orderNumber, customer_email: checkout.email }
      })
      : null;
    const paymentStatus = checkout.paymentMethod === "razorpay" ? "pending" : "cod";
    const orderResult = await client.query(`
      INSERT INTO orders (
        order_number, customer_id, coupon_id, customer_name, email, phone, shipping_address,
        subtotal_paise, discount_paise, shipping_paise, total_paise,
        payment_method, payment_status, customer_notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::JSONB, $8, $9, $10, $11, $12, $13, $14
      )
      RETURNING id, order_number, status, payment_method, payment_status, created_at
    `, [
      orderNumber,
      customer?.id || null,
      couponId,
      checkout.customerName,
      checkout.email,
      checkout.phone,
      JSON.stringify(checkout.shippingAddress),
      subtotalPaise,
      discountPaise,
      shippingPaise,
      totalPaise,
      checkout.paymentMethod,
      paymentStatus,
      checkout.customerNotes
    ]);
    const createdOrder = orderResult.rows[0];

    if (razorpayOrder) {
      await client.query(`
        INSERT INTO payments (order_id, provider, provider_order_id, amount_paise, currency, status, provider_payload)
        VALUES ($1, 'razorpay', $2, $3, 'INR', 'created', $4::JSONB)
      `, [createdOrder.id, razorpayOrder.id, totalPaise, JSON.stringify(razorpayOrder)]);
    }

    for (const item of itemsResult.rows) {
      const lineTotalPaise = item.unit_price_paise * item.quantity;
      await client.query(`
        INSERT INTO order_items (
          order_id, product_id, product_name, sku, unit_price_paise, quantity, line_total_paise
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        createdOrder.id,
        item.product_id,
        item.product_name,
        item.sku,
        item.unit_price_paise,
        item.quantity,
        lineTotalPaise
      ]);
      await client.query(
        "UPDATE inventory SET quantity = quantity - $2, updated_at = NOW() WHERE product_id = $1",
        [item.product_id, item.quantity]
      );
    }

    await client.query("UPDATE carts SET status = 'converted' WHERE id = $1", [activeCart.id]);

    if (customer && checkout.saveAddress) {
      const address = parseAddress({
        ...checkout.shippingAddress,
        phone: checkout.phone,
        label: "Home",
        isDefault: true
      }, customer);
      await client.query("UPDATE addresses SET is_default = FALSE WHERE customer_id = $1", [customer.id]);
      await client.query(`
        INSERT INTO addresses (
          customer_id, label, recipient_name, phone, line1, line2, city, state,
          postal_code, country_code, is_default
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
      `, [customer.id, address.label, address.recipientName, address.phone, address.line1,
        address.line2, address.city, address.state, address.postalCode, address.countryCode]);
    }

    const order = {
      id: createdOrder.id,
      orderNumber: createdOrder.order_number,
      status: createdOrder.status,
      paymentMethod: createdOrder.payment_method,
      paymentStatus: createdOrder.payment_status,
      createdAt: createdOrder.created_at,
      customerName: checkout.customerName,
      email: checkout.email,
      phone: checkout.phone,
      shippingAddress: checkout.shippingAddress,
      items: itemsResult.rows.map((item) => ({
        productId: item.product_id,
        name: item.product_name,
        sku: item.sku,
        unitPricePaise: item.unit_price_paise,
        quantity: item.quantity,
        lineTotalPaise: item.unit_price_paise * item.quantity
      })),
      couponCode,
      subtotalPaise,
      discountPaise,
      shippingPaise,
      totalPaise
    };
    const payment = razorpayOrder ? {
      provider: "razorpay",
      keyId: razorpayKeyId,
      providerOrderId: razorpayOrder.id,
      amountPaise: totalPaise,
      currency: "INR"
    } : null;
    return { order, payment };
  });

  response.status(201).json(result);
}));

const verifyHmac = (message, signature, secret) => {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(message).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
};

app.post("/api/payments/razorpay/verify", asyncRoute(async (request, response) => {
  if (!razorpayKeySecret) throw new ApiError(503, "Razorpay is not configured");
  const orderId = parseText(request.body?.orderId, "Order ID", { max: 100 });
  const paymentId = parseText(request.body?.razorpayPaymentId, "Razorpay payment ID", { max: 100 });
  const returnedOrderId = parseText(request.body?.razorpayOrderId, "Razorpay order ID", { max: 100 });
  const signature = parseText(request.body?.razorpaySignature, "Razorpay signature", { max: 128 });

  const order = await withTransaction(async (client) => {
    const result = await client.query(`
      SELECT
        p.id AS payment_id,
        p.provider_order_id,
        p.provider_payment_id,
        p.status AS payment_record_status,
        o.id,
        o.order_number,
        o.status,
        o.payment_status,
        o.total_paise,
        o.customer_name,
        o.email,
        o.shipping_address
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE o.id::TEXT = $1 AND p.provider = 'razorpay'
      FOR UPDATE OF p, o
    `, [orderId]);
    if (result.rowCount === 0) throw new ApiError(404, "Payment order not found");
    const record = result.rows[0];
    if (record.provider_order_id !== returnedOrderId) throw new ApiError(400, "Razorpay order does not match");
    if (!verifyHmac(`${record.provider_order_id}|${paymentId}`, signature, razorpayKeySecret)) {
      throw new ApiError(400, "Payment signature verification failed");
    }
    const providerPayment = await fetchRazorpayPayment(paymentId);
    if (providerPayment.status !== "captured"
      || providerPayment.order_id !== record.provider_order_id
      || Number(providerPayment.amount) !== record.total_paise
      || providerPayment.currency !== "INR") {
      throw new ApiError(409, "Razorpay payment has not been captured for this order");
    }
    if (record.provider_payment_id && record.provider_payment_id !== paymentId) {
      throw new ApiError(409, "A different payment is already recorded for this order");
    }

    await client.query(`
      UPDATE payments
      SET provider_payment_id = $2, status = 'captured', provider_payload = $3::JSONB
      WHERE id = $1
    `, [record.payment_id, paymentId, JSON.stringify(providerPayment)]);
    await client.query(`
      UPDATE orders
      SET payment_status = 'paid', status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
      WHERE id = $1
    `, [record.id]);

    return {
      id: record.id,
      orderNumber: record.order_number,
      status: record.status === "pending" ? "confirmed" : record.status,
      paymentMethod: "razorpay",
      paymentStatus: "paid",
      totalPaise: record.total_paise,
      customerName: record.customer_name,
      email: record.email,
      shippingAddress: record.shipping_address
    };
  });

  response.json({ verified: true, order });
}));

const processRazorpayWebhook = async (eventId, event) => {
  const paymentEntity = event?.payload?.payment?.entity;
  if (!paymentEntity?.order_id) return;
  await withTransaction(async (client) => {
    const inserted = await client.query(`
      INSERT INTO razorpay_webhook_events (event_id, event_type)
      VALUES ($1, $2)
      ON CONFLICT (event_id) DO NOTHING
    `, [eventId, String(event.event || "unknown")]);
    if (inserted.rowCount === 0) return;

    const paymentResult = await client.query(`
      SELECT p.id, p.order_id, p.status
      FROM payments p
      WHERE p.provider = 'razorpay' AND p.provider_order_id = $1
      FOR UPDATE
    `, [paymentEntity.order_id]);
    if (paymentResult.rowCount === 0) return;
    const payment = paymentResult.rows[0];

    if (event.event === "payment.captured") {
      await client.query(`
        UPDATE payments SET provider_payment_id = $2, status = 'captured', provider_payload = $3::JSONB WHERE id = $1
      `, [payment.id, paymentEntity.id, JSON.stringify(paymentEntity)]);
      await client.query(`
        UPDATE orders SET payment_status = 'paid', status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END WHERE id = $1
      `, [payment.order_id]);
    } else if (event.event === "payment.authorized" && payment.status !== "captured") {
      await client.query(`
        UPDATE payments SET provider_payment_id = $2, status = 'authorized', provider_payload = $3::JSONB WHERE id = $1
      `, [payment.id, paymentEntity.id, JSON.stringify(paymentEntity)]);
    } else if (event.event === "payment.failed" && payment.status !== "captured") {
      await client.query("UPDATE payments SET status = 'failed', provider_payload = $2::JSONB WHERE id = $1", [payment.id, JSON.stringify(paymentEntity)]);
      await client.query("UPDATE orders SET payment_status = 'failed' WHERE id = $1 AND payment_status <> 'paid'", [payment.order_id]);
    } else if (event.event === "payment.refunded") {
      await client.query("UPDATE payments SET status = 'refunded', provider_payload = $2::JSONB WHERE id = $1", [payment.id, JSON.stringify(paymentEntity)]);
      await client.query("UPDATE orders SET payment_status = 'refunded' WHERE id = $1", [payment.order_id]);
    }
  });
};

app.post("/api/payments/razorpay/webhook", (request, response) => {
  if (!razorpayWebhookSecret) return response.status(503).json({ error: "Razorpay webhook is not configured" });
  const signature = request.get("x-razorpay-signature") || "";
  if (!request.rawBody || !verifyHmac(request.rawBody, signature, razorpayWebhookSecret)) {
    return response.status(400).json({ error: "Invalid webhook signature" });
  }
  const eventId = request.get("x-razorpay-event-id") || crypto.createHash("sha256").update(request.rawBody).digest("hex");
  response.status(200).json({ received: true });
  setImmediate(() => processRazorpayWebhook(eventId, request.body).catch((error) => {
    console.error("Razorpay webhook processing failed", error);
  }));
});

const orderStatuses = new Set(["pending", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"]);
const allowedOrderTransitions = {
  pending: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["packed", "cancelled"]),
  packed: new Set(["shipped", "cancelled"]),
  shipped: new Set(["delivered", "returned"]),
  delivered: new Set(["returned"]),
  cancelled: new Set(),
  returned: new Set()
};
const scentFamilies = new Set(["floral", "fresh", "woody", "sets"]);

const parseAdminProduct = (body = {}) => {
  const slug = parseText(body.slug, "Slug", { max: 100 }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new ApiError(400, "Slug must contain lowercase letters, numbers and single hyphens");
  const sku = parseText(body.sku, "SKU", { max: 60 }).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(sku)) throw new ApiError(400, "SKU may contain uppercase letters, numbers and hyphens");

  const scentFamily = parseText(body.scentFamily, "Scent family", { max: 30 }).toLowerCase();
  if (!scentFamilies.has(scentFamily)) throw new ApiError(400, "Invalid scent family");

  const integerField = (value, label, { min = 0, max = 100_000_000 } = {}) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new ApiError(400, `${label} must be an integer between ${min} and ${max}`);
    }
    return parsed;
  };
  const booleanField = (value, label) => {
    if (typeof value !== "boolean") throw new ApiError(400, `${label} must be true or false`);
    return value;
  };

  const pricePaise = integerField(body.pricePaise, "Price");
  const compareAtPricePaise = body.compareAtPricePaise === null || body.compareAtPricePaise === ""
    ? null
    : integerField(body.compareAtPricePaise, "Compare-at price");
  if (compareAtPricePaise !== null && compareAtPricePaise < pricePaise) {
    throw new ApiError(400, "Compare-at price cannot be lower than the selling price");
  }

  return {
    categorySlug: parseText(body.categorySlug, "Category", { max: 100 }).toLowerCase(),
    slug,
    sku,
    name: parseText(body.name, "Product name", { min: 2, max: 140 }),
    shortDescription: parseText(body.shortDescription, "Short description", { max: 240, optional: true }),
    description: parseText(body.description, "Description", { max: 4000, optional: true }),
    scentFamily,
    concentration: parseText(body.concentration, "Concentration", { min: 2, max: 80 }),
    sizeMl: integerField(body.sizeMl, "Size", { min: 1, max: 10_000 }),
    pricePaise,
    compareAtPricePaise,
    featured: booleanField(body.featured, "Featured"),
    active: booleanField(body.active, "Active"),
    quantity: integerField(body.quantity, "Inventory quantity", { max: 1_000_000 }),
    lowStockThreshold: integerField(body.lowStockThreshold, "Low-stock threshold", { max: 1_000_000 }),
    imageUrl: parseText(body.imageUrl || "/perfume.jpg", "Image URL", { max: 500 }),
    imageAlt: parseText(body.imageAlt || `${body.name || "Buva"} fragrance by Buva Chennai`, "Image alt text", { max: 240 })
  };
};

const adminProductSelect = `
  SELECT
    p.id,
    p.slug,
    p.sku,
    p.name,
    p.short_description AS "shortDescription",
    p.description,
    p.scent_family AS "scentFamily",
    p.concentration,
    p.size_ml AS "sizeMl",
    p.price_paise AS "pricePaise",
    p.compare_at_price_paise AS "compareAtPricePaise",
    p.featured,
    p.active,
    p.created_at AS "createdAt",
    p.updated_at AS "updatedAt",
    c.slug AS "categorySlug",
    c.name AS "categoryName",
    i.quantity,
    i.reserved_quantity AS "reservedQuantity",
    (i.quantity - i.reserved_quantity) AS "availableQuantity",
    i.low_stock_threshold AS "lowStockThreshold",
    image.image_url AS "imageUrl",
    image.alt_text AS "imageAlt"
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN inventory i ON i.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT image_url, alt_text
    FROM product_images
    WHERE product_id = p.id
    ORDER BY display_order, id
    LIMIT 1
  ) image ON TRUE
`;

app.use("/api/admin", requireAdmin);

const getAdminProduct = async (productId, client = pool) => {
  const result = await client.query(`${adminProductSelect} WHERE p.id = $1`, [productId]);
  return result.rows[0] || null;
};

app.get("/api/admin/catalog/categories", asyncRoute(async (_request, response) => {
  const result = await pool.query(`
    SELECT slug, name, active
    FROM categories
    ORDER BY display_order, name
  `);
  response.json({ categories: result.rows });
}));

app.get("/api/admin/products", asyncRoute(async (request, response) => {
  const active = typeof request.query.active === "string" ? request.query.active.toLowerCase() : "all";
  if (!["all", "true", "false"].includes(active)) throw new ApiError(400, "active must be all, true or false");
  const lowStock = request.query.lowStock === "true";
  if (request.query.lowStock !== undefined && !["true", "false"].includes(request.query.lowStock)) {
    throw new ApiError(400, "lowStock must be true or false");
  }
  const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 100) : "";

  const filters = [];
  const values = [];
  if (active !== "all") {
    values.push(active === "true");
    filters.push(`p.active = $${values.length}`);
  }
  if (lowStock) filters.push("(i.quantity - i.reserved_quantity) <= i.low_stock_threshold");
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR p.slug ILIKE $${values.length})`);
  }

  const [productsResult, summaryResult] = await Promise.all([
    pool.query(`
      ${adminProductSelect}
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY p.active DESC, p.featured DESC, p.name
    `, values),
    pool.query(`
      SELECT
        COUNT(*)::INTEGER AS "totalProducts",
        COUNT(*) FILTER (WHERE p.active)::INTEGER AS "activeProducts",
        COUNT(*) FILTER (WHERE (i.quantity - i.reserved_quantity) <= i.low_stock_threshold)::INTEGER AS "lowStockProducts",
        COALESCE(SUM(i.quantity - i.reserved_quantity), 0)::BIGINT AS "availableUnits"
      FROM products p
      JOIN inventory i ON i.product_id = p.id
    `)
  ]);
  response.json({
    products: productsResult.rows,
    summary: {
      ...summaryResult.rows[0],
      availableUnits: Number(summaryResult.rows[0].availableUnits)
    },
    meta: { count: productsResult.rowCount, active, lowStock, search: search || null }
  });
}));

app.post("/api/admin/products", asyncRoute(async (request, response) => {
  const input = parseAdminProduct(request.body);
  const product = await withTransaction(async (client) => {
    const categoryResult = await client.query("SELECT id FROM categories WHERE slug = $1", [input.categorySlug]);
    if (categoryResult.rowCount === 0) throw new ApiError(400, "Category not found");

    const productResult = await client.query(`
      INSERT INTO products (
        category_id, slug, sku, name, short_description, description, scent_family,
        concentration, size_ml, price_paise, compare_at_price_paise, featured, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      categoryResult.rows[0].id,
      input.slug,
      input.sku,
      input.name,
      input.shortDescription,
      input.description,
      input.scentFamily,
      input.concentration,
      input.sizeMl,
      input.pricePaise,
      input.compareAtPricePaise,
      input.featured,
      input.active
    ]);
    const productId = productResult.rows[0].id;
    await client.query(`
      INSERT INTO inventory (product_id, quantity, low_stock_threshold)
      VALUES ($1, $2, $3)
    `, [productId, input.quantity, input.lowStockThreshold]);
    await client.query(`
      INSERT INTO product_images (product_id, image_url, alt_text, display_order)
      VALUES ($1, $2, $3, 0)
    `, [productId, input.imageUrl, input.imageAlt]);
    return getAdminProduct(productId, client);
  });

  response.status(201).json({ product });
}));

app.patch("/api/admin/products/:productId", asyncRoute(async (request, response) => {
  const productId = parseProductId(request.params.productId);
  const product = await withTransaction(async (client) => {
    const currentResult = await client.query(`
      ${adminProductSelect}
      WHERE p.id = $1
      FOR UPDATE OF p, i
    `, [productId]);
    if (currentResult.rowCount === 0) throw new ApiError(404, "Product not found");
    const current = currentResult.rows[0];
    const input = parseAdminProduct({ ...current, ...request.body });
    if (input.quantity < current.reservedQuantity) {
      throw new ApiError(409, `Inventory cannot be lower than ${current.reservedQuantity} reserved units`);
    }

    const categoryResult = await client.query("SELECT id FROM categories WHERE slug = $1", [input.categorySlug]);
    if (categoryResult.rowCount === 0) throw new ApiError(400, "Category not found");
    await client.query(`
      UPDATE products SET
        category_id = $2,
        slug = $3,
        sku = $4,
        name = $5,
        short_description = $6,
        description = $7,
        scent_family = $8,
        concentration = $9,
        size_ml = $10,
        price_paise = $11,
        compare_at_price_paise = $12,
        featured = $13,
        active = $14
      WHERE id = $1
    `, [
      productId,
      categoryResult.rows[0].id,
      input.slug,
      input.sku,
      input.name,
      input.shortDescription,
      input.description,
      input.scentFamily,
      input.concentration,
      input.sizeMl,
      input.pricePaise,
      input.compareAtPricePaise,
      input.featured,
      input.active
    ]);
    await client.query(`
      UPDATE inventory
      SET quantity = $2, low_stock_threshold = $3, updated_at = NOW()
      WHERE product_id = $1
    `, [productId, input.quantity, input.lowStockThreshold]);
    await client.query(`
      INSERT INTO product_images (product_id, image_url, alt_text, display_order)
      VALUES ($1, $2, $3, 0)
      ON CONFLICT (product_id, display_order)
      DO UPDATE SET image_url = EXCLUDED.image_url, alt_text = EXCLUDED.alt_text
    `, [productId, input.imageUrl, input.imageAlt]);
    return getAdminProduct(productId, client);
  });

  response.json({ product });
}));

app.get("/api/admin/orders", asyncRoute(async (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status.toLowerCase() : null;
  if (status && !orderStatuses.has(status)) throw new ApiError(400, "Invalid order status");
  const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 100) : "";
  const requestedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;

  const filters = [];
  const values = [];
  if (status) {
    values.push(status);
    filters.push(`o.status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(o.order_number ILIKE $${values.length} OR o.customer_name ILIKE $${values.length} OR o.email ILIKE $${values.length})`);
  }
  values.push(limit);

  const [ordersResult, summaryResult] = await Promise.all([
    pool.query(`
      SELECT
        o.id,
        o.order_number AS "orderNumber",
        o.customer_name AS "customerName",
        o.email,
        o.shipping_address->>'city' AS city,
        o.total_paise AS "totalPaise",
        o.status,
        o.payment_method AS "paymentMethod",
        o.payment_status AS "paymentStatus",
        o.created_at AS "createdAt",
        COALESCE(lines.item_count, 0)::INTEGER AS "itemCount"
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT SUM(quantity)::INTEGER AS item_count
        FROM order_items
        WHERE order_id = o.id
      ) lines ON TRUE
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY o.created_at DESC
      LIMIT $${values.length}
    `, values),
    pool.query(`
      SELECT
        COUNT(*)::INTEGER AS "totalOrders",
        COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS "pendingOrders",
        COUNT(*) FILTER (WHERE status IN ('confirmed', 'packed'))::INTEGER AS "fulfilmentOrders",
        COUNT(*) FILTER (WHERE status = 'shipped')::INTEGER AS "shippedOrders",
        COALESCE(SUM(total_paise) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0)::BIGINT AS "revenuePaise"
      FROM orders
    `)
  ]);

  response.json({
    orders: ordersResult.rows,
    summary: {
      ...summaryResult.rows[0],
      revenuePaise: Number(summaryResult.rows[0].revenuePaise)
    },
    meta: { count: ordersResult.rowCount, status, search: search || null, limit }
  });
}));

app.get("/api/admin/orders/:identifier", asyncRoute(async (request, response) => {
  const order = await getAdminOrder(request.params.identifier);
  if (!order) throw new ApiError(404, "Order not found");
  response.json({ order, allowedTransitions: [...allowedOrderTransitions[order.status]] });
}));

app.patch("/api/admin/orders/:identifier/status", asyncRoute(async (request, response) => {
  const nextStatus = typeof request.body?.status === "string" ? request.body.status.toLowerCase() : "";
  if (!orderStatuses.has(nextStatus)) throw new ApiError(400, "Invalid order status");

  const order = await withTransaction(async (client) => {
    const currentResult = await client.query(`
      SELECT id, status, payment_method, payment_status
      FROM orders
      WHERE id::TEXT = $1 OR order_number = $1
      FOR UPDATE
    `, [request.params.identifier]);
    if (currentResult.rowCount === 0) throw new ApiError(404, "Order not found");

    const current = currentResult.rows[0];
    if (current.status !== nextStatus) {
      if (!allowedOrderTransitions[current.status].has(nextStatus)) {
        throw new ApiError(409, `Order cannot move from ${current.status} to ${nextStatus}`);
      }
      if ((nextStatus === "cancelled" || nextStatus === "returned")
        && current.payment_method === "razorpay"
        && current.payment_status === "paid") {
        throw new ApiError(409, "Refund the Razorpay payment before cancelling or returning this order");
      }
      await client.query("UPDATE orders SET status = $2 WHERE id = $1", [current.id, nextStatus]);

      if (nextStatus === "cancelled" || nextStatus === "returned") {
        await client.query(`
          UPDATE inventory i
          SET quantity = i.quantity + returned.quantity, updated_at = NOW()
          FROM (
            SELECT product_id, SUM(quantity)::INTEGER AS quantity
            FROM order_items
            WHERE order_id = $1 AND product_id IS NOT NULL
            GROUP BY product_id
          ) returned
          WHERE i.product_id = returned.product_id
        `, [current.id]);
      }
    }

    return getAdminOrder(String(current.id), client);
  });

  response.json({ order, allowedTransitions: [...allowedOrderTransitions[order.status]] });
}));

app.use((error, _request, response, _next) => {
  if (error instanceof ApiError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error?.code === "23505") {
    return response.status(409).json({ error: "A product with this slug or SKU already exists" });
  }
  if (error?.code === "23514" || error?.code === "22P02") {
    return response.status(400).json({ error: "The submitted data is invalid" });
  }
  console.error("API request failed", error);
  response.status(500).json({ error: "Internal server error" });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.listen(port, () => console.log(`Buva backend listening on ${port}`));

const shutdown = async () => {
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

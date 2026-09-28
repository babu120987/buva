import express from "express";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import multer from "multer";
import nodemailer from "nodemailer";
import ExcelJS from "exceljs";
import {
  createInvoiceForOrder,
  getAdminInvoice,
  getCustomerInvoice,
  listCustomerInvoices,
  validateInvoiceNumber
} from "./invoices.js";
import { orderConfirmationEmail, paymentConfirmationEmail } from "./order-emails.js";
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
const gmailUser = process.env.GMAIL_USER || "";
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD || "";

const mailTransporter =
  gmailUser && gmailAppPassword
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: gmailUser,
          pass: gmailAppPassword
        }
      })
    : null;

const sendEmail = async ({ to, subject, text, html }) => {
  if (!mailTransporter) {
    console.warn("Email is not configured");
    return { accepted: false, reason: "not_configured" };
  }

  try {
    const result = await mailTransporter.sendMail({
      from: `"Buva" <${gmailUser}>`,
      to,
      subject,
      text,
      html
    });
    const accepted = result.accepted?.some((address) => address.toLowerCase() === to.toLowerCase()) || false;
    if (accepted) console.log(`Email accepted for ${to}: ${subject}`);
    else console.error(`Email rejected for ${to}: ${subject}`);
    return { accepted, reason: accepted ? null : "rejected" };
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
    return { accepted: false, reason: "send_failed" };
  }
};

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || "buva-90d4b";
let firebaseAuth;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    firebaseAuth = new GoogleAuth({
      credentials: JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"]
    });
  }
} catch (error) {
  console.error("Firebase service account is invalid:", error);
}

const sendOrderPush = async (customerId, title, body, orderNumber) => {
  if (!firebaseAuth || !customerId) return;
  const devices = await pool.query("SELECT token FROM notification_devices WHERE customer_id=$1", [customerId]);
  if (!devices.rowCount) return;
  const authClient = await firebaseAuth.getClient();
  const accessToken = await authClient.getAccessToken();
  await Promise.all(devices.rows.map(async ({ token }) => {
    try {
      const result = await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token, notification: { title, body }, webpush: { fcm_options: { link: "https://buva.shop/#account" } }, data: { orderNumber } } })
      });
      if (result.ok) return;
      const error = await result.json().catch(() => ({}));
      if (error.error?.details?.some((detail) => detail.errorCode === "UNREGISTERED")) {
        await pool.query("DELETE FROM notification_devices WHERE token=$1", [token]);
      } else {
        console.error("FCM delivery failed:", result.status, error.error?.message || "Unknown error");
      }
    } catch (error) {
      console.error("FCM delivery failed:", error);
    }
  }));
};

const app = express();
const port = Number(process.env.PORT || 9000);
const adminApiKey = process.env.ADMIN_API_KEY || "";
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const razorpayApiBase = process.env.RAZORPAY_API_BASE || "https://api.razorpay.com/v1";
const ragApiUrl = (process.env.RAG_API_URL || "").replace(/\/$/, "");
const ragApiToken = process.env.RAG_API_TOKEN || "";
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
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
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
    image.alt_text AS "imageAlt",
    COALESCE(review.average_rating, 0)::FLOAT AS "averageRating",
    COALESCE(review.review_count, 0)::INTEGER AS "reviewCount"
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
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(rating)::NUMERIC, 1) AS average_rating, COUNT(*) AS review_count
    FROM product_reviews
    WHERE product_id = p.id AND status = 'approved'
  ) review ON TRUE
`;

const asyncRoute = (handler) => async (request, response, next) => {
  try {
    await handler(request, response);
  } catch (error) {
    next(error);
  }
};

const secureHash = (value) => crypto.createHash("sha256").update(value).digest();
const formatAssistantPrice = (paise) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(paise) / 100)}`;
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

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

const uploadsDir = path.join(process.cwd(), "uploads");

await fs.promises.mkdir(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

const imageStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, uploadsDir);
  },

  filename: (_request, file, callback) => {
    const extension = allowedImageTypes.get(file.mimetype);

    if (!extension) {
      return callback(
        new ApiError(400, "Only JPEG, PNG and WebP images are allowed")
      );
    }

    callback(null, `${crypto.randomUUID()}${extension}`);
  }
});

const uploadProductImages = multer({
  storage: imageStorage,

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10
  },

  fileFilter: (_request, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      return callback(
        new ApiError(400, "Only JPEG, PNG and WebP images are allowed")
      );
    }

    callback(null, true);
  }
});
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
      o.customer_id AS "customerId",
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
      o.courier_name AS "courierName",
      o.tracking_number AS "trackingNumber",
      o.tracking_url AS "trackingUrl",
      o.shipped_at AS "shippedAt",
      o.delivered_at AS "deliveredAt",
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

  const frontendUrl = (process.env.PUBLIC_SITE_URL || "https://buva.shop").replace(/\/$/, "");
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
  const [addressesResult, ordersResult, wishlistResult, preferencesResult, viewsResult, ticketsResult] = await Promise.all([
    pool.query(`
      SELECT id, label, recipient_name AS "recipientName", phone, line1, line2,
        city, state, postal_code AS "postalCode", country_code AS "countryCode", is_default AS "isDefault"
      FROM addresses WHERE customer_id = $1
      ORDER BY is_default DESC, created_at DESC
    `, [customer.id]),
    pool.query(`
      SELECT
        o.id,
        o.order_number AS "orderNumber",
        o.total_paise AS "totalPaise",
        o.status,
        o.payment_method AS "paymentMethod",
        o.payment_status AS "paymentStatus",
        o.courier_name AS "courierName",
        o.tracking_number AS "trackingNumber",
        o.tracking_url AS "trackingUrl",
        o.shipped_at AS "shippedAt",
        o.delivered_at AS "deliveredAt",
        o.created_at AS "createdAt",
        i.invoice_number AS "invoiceNumber",
        COALESCE(items.items, '[]'::JSON) AS items,
        rr.id AS "returnRequestId",
        rr.reason AS "returnReason",
        rr.customer_note AS "returnCustomerNote",
        rr.status AS "returnRequestStatus",
        rr.admin_note AS "returnAdminNote",
        rr.created_at AS "returnRequestedAt",
        rr.updated_at AS "returnUpdatedAt"
      FROM orders o
      LEFT JOIN invoices i ON i.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT JSON_AGG(JSON_BUILD_OBJECT(
          'productId', oi.product_id, 'name', oi.product_name, 'quantity', oi.quantity,
          'reviewId', pr.id, 'reviewStatus', pr.status, 'rating', pr.rating
        ) ORDER BY oi.id) AS items
        FROM order_items oi
        LEFT JOIN product_reviews pr ON pr.order_id=oi.order_id AND pr.product_id=oi.product_id AND pr.customer_id=$1
        WHERE oi.order_id=o.id
      ) items ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          id,
          reason,
          customer_note,
          status,
          admin_note,
          created_at,
          updated_at
        FROM return_requests
        WHERE order_id = o.id
        ORDER BY created_at DESC
        LIMIT 1
      ) rr ON TRUE
      WHERE o.customer_id = $1
      ORDER BY o.created_at DESC
      LIMIT 20
    `, [customer.id]),
    pool.query(`
      SELECT p.id AS "productId", p.slug, p.name, p.price_paise AS "pricePaise",
        image.image_url AS "imageUrl", w.created_at AS "createdAt"
      FROM wishlists w
      JOIN products p ON p.id = w.product_id AND p.active = TRUE
      LEFT JOIN LATERAL (
        SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order, id LIMIT 1
      ) image ON TRUE
      WHERE w.customer_id = $1 ORDER BY w.created_at DESC
    `, [customer.id]),
    pool.query(`
      SELECT order_updates AS "orderUpdates", marketing
      FROM notification_preferences WHERE customer_id = $1
    `, [customer.id]),
    pool.query(`
      SELECT p.id AS "productId", p.slug, p.name, p.price_paise AS "pricePaise",
        p.scent_family AS "scentFamily", image.image_url AS "imageUrl", v.viewed_at AS "viewedAt"
      FROM product_views v
      JOIN products p ON p.id=v.product_id AND p.active=TRUE
      LEFT JOIN LATERAL (
        SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY display_order, id LIMIT 1
      ) image ON TRUE
      WHERE v.customer_id=$1 ORDER BY v.viewed_at DESC LIMIT 12
    `, [customer.id]),
    pool.query(`
      SELECT id, topic, message, status, customer_reply AS "customerReply",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM support_tickets WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20
    `, [customer.id])
  ]);
  const { sessionId: _sessionId, tokenHash: _tokenHash, ...profile } = customer;
  response.json({
    customer: profile,
    addresses: addressesResult.rows,
    orders: ordersResult.rows,
    wishlist: wishlistResult.rows,
    recentlyViewed: viewsResult.rows,
    supportTickets: ticketsResult.rows,
    notificationPreferences: preferencesResult.rows[0] || { orderUpdates: true, marketing: false }
  });
}));

app.post("/api/account/view-history", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const productId = parseProductId(request.body?.productId);
  const result = await pool.query(`
    INSERT INTO product_views(customer_id, product_id) SELECT $1, id FROM products WHERE id=$2 AND active=TRUE
    ON CONFLICT(customer_id, product_id) DO UPDATE SET viewed_at=NOW()
    RETURNING product_id
  `, [customer.id, productId]);
  if (!result.rowCount) throw new ApiError(404, "Product not found");
  response.status(204).end();
}));

app.get("/api/account/recommendations", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const result = await pool.query(`
    WITH interests AS (
      SELECT p.scent_family, 3 AS weight FROM product_views v JOIN products p ON p.id=v.product_id WHERE v.customer_id=$1
      UNION ALL
      SELECT p.scent_family, 4 FROM wishlists w JOIN products p ON p.id=w.product_id WHERE w.customer_id=$1
      UNION ALL
      SELECT p.scent_family, 5 FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id WHERE o.customer_id=$1
    ), interest_scores AS (
      SELECT scent_family, SUM(weight) AS score FROM interests GROUP BY scent_family
    )
    ${productSelect}
    LEFT JOIN interest_scores scores ON scores.scent_family=p.scent_family
    WHERE p.active=TRUE AND c.active=TRUE AND p.id NOT IN (
      SELECT product_id FROM product_views WHERE customer_id=$1
    )
    ORDER BY COALESCE(scores.score, 0) DESC, p.featured DESC, p.created_at DESC
    LIMIT 4
  `, [customer.id]);
  response.json({ products: result.rows });
}));

app.get("/api/invoices", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const invoices = await listCustomerInvoices(pool, customer.id);
  response.json({ invoices, meta: { count: invoices.length } });
}));

app.get("/api/invoices/:invoiceNumber", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const invoiceNumber = validateInvoiceNumber(request.params.invoiceNumber);
  const invoice = await getCustomerInvoice(pool, customer.id, invoiceNumber);
  if (!invoice) throw new ApiError(404, "Invoice not found");
  response.json({ invoice });
}));

app.patch("/api/account/profile", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const fullName = parseText(request.body?.fullName, "Full name", { min: 2, max: 100 });
  const phone = parseText(request.body?.phone, "Phone", { min: 10, max: 20 }).replace(/\D/g, "");
  if (phone.length < 10 || phone.length > 15) throw new ApiError(400, "A valid phone number is required");
  const result = await pool.query(`
    UPDATE customers SET full_name = $2, phone = $3, updated_at = NOW()
    WHERE id = $1 RETURNING id, email, phone, full_name AS "fullName"
  `, [customer.id, fullName, phone]);
  response.json({ customer: result.rows[0] });
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

app.patch("/api/account/addresses/:addressId", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const address = parseAddress(request.body, customer);
  const updated = await withTransaction(async (client) => {
    if (address.isDefault) await client.query("UPDATE addresses SET is_default = FALSE WHERE customer_id = $1", [customer.id]);
    const result = await client.query(`
      UPDATE addresses SET label=$3, recipient_name=$4, phone=$5, line1=$6, line2=$7,
        city=$8, state=$9, postal_code=$10, country_code=$11, is_default=$12, updated_at=NOW()
      WHERE id=$2 AND customer_id=$1
      RETURNING id, label, recipient_name AS "recipientName", phone, line1, line2, city, state,
        postal_code AS "postalCode", country_code AS "countryCode", is_default AS "isDefault"
    `, [customer.id, request.params.addressId, address.label, address.recipientName, address.phone,
      address.line1, address.line2, address.city, address.state, address.postalCode, address.countryCode, address.isDefault]);
    if (!result.rows[0]) throw new ApiError(404, "Address not found");
    return result.rows[0];
  });
  response.json({ address: updated });
}));

app.delete("/api/account/addresses/:addressId", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const result = await pool.query("DELETE FROM addresses WHERE id=$1 AND customer_id=$2 RETURNING id", [request.params.addressId, customer.id]);
  if (!result.rows[0]) throw new ApiError(404, "Address not found");
  response.status(204).end();
}));

app.post("/api/account/wishlist/:productId", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const productId = parseProductId(request.params.productId);
  const result = await pool.query(`
    INSERT INTO wishlists(customer_id, product_id)
    SELECT $1, id FROM products WHERE id=$2 AND active=TRUE
    ON CONFLICT DO NOTHING RETURNING product_id AS "productId"
  `, [customer.id, productId]);
  if (!result.rows[0]) {
    const exists = await pool.query("SELECT 1 FROM products WHERE id=$1 AND active=TRUE", [productId]);
    if (!exists.rows[0]) throw new ApiError(404, "Product not found");
  }
  response.status(201).json({ productId: Number(productId), wished: true });
}));

app.delete("/api/account/wishlist/:productId", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const productId = parseProductId(request.params.productId);
  await pool.query("DELETE FROM wishlists WHERE customer_id=$1 AND product_id=$2", [customer.id, productId]);
  response.status(204).end();
}));

app.put("/api/account/notification-preferences", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const orderUpdates = request.body?.orderUpdates !== false;
  const marketing = request.body?.marketing === true;
  const result = await pool.query(`
    INSERT INTO notification_preferences(customer_id, order_updates, marketing) VALUES($1,$2,$3)
    ON CONFLICT(customer_id) DO UPDATE SET order_updates=$2, marketing=$3, updated_at=NOW()
    RETURNING order_updates AS "orderUpdates", marketing
  `, [customer.id, orderUpdates, marketing]);
  response.json({ preferences: result.rows[0] });
}));

app.post("/api/account/notification-devices", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const token = parseText(request.body?.token, "Notification token", { min: 20, max: 4096 });
  await pool.query(`
    INSERT INTO notification_devices(token, customer_id) VALUES($1,$2)
    ON CONFLICT(token) DO UPDATE SET customer_id=$2, updated_at=NOW()
  `, [token, customer.id]);
  response.status(204).end();
}));

app.delete("/api/account/notification-devices", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const token = parseText(request.body?.token, "Notification token", { min: 20, max: 4096 });
  await pool.query("DELETE FROM notification_devices WHERE token=$1 AND customer_id=$2", [token, customer.id]);
  response.status(204).end();
}));

app.post("/api/account/orders/:orderId/reviews", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const orderId = String(request.params.orderId || "").trim();
  const productId = Number(request.body?.productId);
  const rating = Number(request.body?.rating);
  const reviewText = parseText(request.body?.reviewText, "Review", {
    max: 2000,
    optional: true
  });

  if (!Number.isInteger(productId) || productId <= 0) {
    throw new ApiError(400, "Valid productId is required");
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be between 1 and 5");
  }

  const orderResult = await pool.query(`
    SELECT id, order_number AS "orderNumber", status
    FROM orders
    WHERE id = $1 AND customer_id = $2
  `, [orderId, customer.id]);

  const order = orderResult.rows[0];

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.status !== "delivered") {
    throw new ApiError(400, "You can review products only after the order is delivered");
  }

  const itemResult = await pool.query(`
    SELECT product_id AS "productId", product_name AS "productName"
    FROM order_items
    WHERE order_id = $1
      AND product_id = $2
    LIMIT 1
  `, [order.id, productId]);

  const item = itemResult.rows[0];

  if (!item) {
    throw new ApiError(403, "You can review only products purchased in this order");
  }

  const existingResult = await pool.query(`
    SELECT id
    FROM product_reviews
    WHERE customer_id = $1
      AND order_id = $2
      AND product_id = $3
    LIMIT 1
  `, [customer.id, order.id, productId]);

  if (existingResult.rows[0]) {
    throw new ApiError(409, "You have already reviewed this product for this order");
  }

  const result = await pool.query(`
    INSERT INTO product_reviews (
      product_id,
      customer_id,
      order_id,
      rating,
      review_text
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id,
      product_id AS "productId",
      order_id AS "orderId",
      rating,
      review_text AS "reviewText",
      status,
      admin_note AS "adminNote",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `, [
    productId,
    customer.id,
    order.id,
    rating,
    reviewText
  ]);

  response.status(201).json({
    review: {
      ...result.rows[0],
      orderNumber: order.orderNumber,
      productName: item.productName
    }
  });
}));

app.post("/api/account/orders/:orderId/return-request", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request, pool, true);
  const orderId = String(request.params.orderId || "").trim();
  const reason = parseText(request.body?.reason, "Return reason", { min: 3, max: 200 });
  const customerNote = parseText(request.body?.customerNote, "Return note", {
    max: 1000,
    optional: true
  });

  const orderResult = await pool.query(`
    SELECT id, order_number AS "orderNumber", status
    FROM orders
    WHERE id = $1 AND customer_id = $2
  `, [orderId, customer.id]);

  const order = orderResult.rows[0];
  if (!order) throw new ApiError(404, "Order not found");

  if (order.status !== "delivered") {
    throw new ApiError(400, "A return can only be requested for a delivered order");
  }

  const existingResult = await pool.query(`
    SELECT id, status
    FROM return_requests
    WHERE order_id = $1
      AND status IN ('pending', 'approved')
    LIMIT 1
  `, [order.id]);

  if (existingResult.rows[0]) {
    throw new ApiError(409, "A return request already exists for this order");
  }

  const result = await pool.query(`
    INSERT INTO return_requests (
      order_id,
      customer_id,
      reason,
      customer_note
    )
    VALUES ($1, $2, $3, $4)
    RETURNING
      id,
      order_id AS "orderId",
      reason,
      customer_note AS "customerNote",
      status,
      admin_note AS "adminNote",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `, [order.id, customer.id, reason, customerNote]);

  response.status(201).json({
    returnRequest: {
      ...result.rows[0],
      orderNumber: order.orderNumber
    }
  });
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

app.get("/api/banners", asyncRoute(async (request, response) => {
  const placement = request.query.placement === "shop" ? "shop" : "home";
  const result = await pool.query(`
    SELECT id, title, subtitle, image_url AS "imageUrl", link_url AS "linkUrl", placement
    FROM banners WHERE active=TRUE AND placement=$1
      AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())
    ORDER BY display_order, id
  `, [placement]);
  response.json({ banners: result.rows });
}));

app.get("/api/products", asyncRoute(async (request, response) => {
  const family = typeof request.query.family === "string" ? request.query.family.toLowerCase() : null;
  const featured = request.query.featured;
  const requestedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 100;
  const validFamilies = new Set(["floral", "fresh", "woody", "mist", "sets"]);
  const search = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100) : "";
  const sort = typeof request.query.sort === "string" ? request.query.sort : "featured";
  const minPrice = request.query.minPrice === undefined ? null : Number(request.query.minPrice);
  const maxPrice = request.query.maxPrice === undefined ? null : Number(request.query.maxPrice);
  const sortSql = {
    featured: "p.featured DESC, p.created_at, p.id",
    newest: "p.created_at DESC, p.id DESC",
    price_asc: "p.price_paise ASC, p.id",
    price_desc: "p.price_paise DESC, p.id",
    rating: "\"averageRating\" DESC, \"reviewCount\" DESC, p.id"
  }[sort];

  if (family && !validFamilies.has(family)) {
    return response.status(400).json({ error: "Invalid scent family" });
  }
  if (featured !== undefined && featured !== "true" && featured !== "false") {
    return response.status(400).json({ error: "featured must be true or false" });
  }
  if (!sortSql) throw new ApiError(400, "Invalid product sort");
  if (minPrice !== null && (!Number.isInteger(minPrice) || minPrice < 0)) throw new ApiError(400, "Invalid minimum price");
  if (maxPrice !== null && (!Number.isInteger(maxPrice) || maxPrice < 0)) throw new ApiError(400, "Invalid maximum price");
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new ApiError(400, "Minimum price cannot exceed maximum price");

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
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(p.name ILIKE $${values.length} OR p.short_description ILIKE $${values.length}
      OR p.description ILIKE $${values.length} OR p.scent_family ILIKE $${values.length}
      OR p.concentration ILIKE $${values.length})`);
  }
  if (minPrice !== null) { values.push(minPrice); filters.push(`p.price_paise >= $${values.length}`); }
  if (maxPrice !== null) { values.push(maxPrice); filters.push(`p.price_paise <= $${values.length}`); }
  values.push(limit);

  const result = await pool.query(`
    ${productSelect}
    WHERE ${filters.join(" AND ")}
    ORDER BY ${sortSql}
    LIMIT $${values.length}
  `, values);

  response.json({
    products: result.rows,
    meta: { count: result.rowCount, family, featured: featured === undefined ? null : featured === "true", search: search || null, sort }
  });
}));

app.get("/api/products/:slug", asyncRoute(async (request, response) => {
  const [result, reviewsResult] = await Promise.all([pool.query(`
    ${productSelect}
    WHERE p.slug = $1 AND p.active = TRUE AND c.active = TRUE
  `, [request.params.slug]), pool.query(`
    SELECT r.id, r.rating, r.review_text AS "reviewText", r.created_at AS "createdAt",
      LEFT(c.full_name, 1) || '***' AS "reviewerName"
    FROM product_reviews r JOIN products p ON p.id=r.product_id JOIN customers c ON c.id=r.customer_id
    WHERE p.slug=$1 AND r.status='approved' ORDER BY r.created_at DESC LIMIT 50
  `, [request.params.slug])]);

  if (result.rowCount === 0) {
    return response.status(404).json({ error: "Product not found" });
  }

  response.json({ product: result.rows[0], reviews: reviewsResult.rows });
}));

app.post("/api/coupons/validate", asyncRoute(async (request, response) => {
  const code = parseText(request.body?.code, "Coupon code", { max: 40 }).toUpperCase();
  const sessionToken = parseText(request.body?.sessionToken, "Cart token", { min: 16, max: 128 });
  const cart = await getCart(sessionToken);
  if (!cart || !cart.items.length) throw new ApiError(400, "A non-empty cart is required");
  const subtotalPaise = cart.subtotalPaise;
  const result = await pool.query(`
    SELECT c.code, c.discount_type, c.discount_value, c.minimum_order_paise, c.usage_limit,
      (SELECT COUNT(*)::INTEGER FROM orders o WHERE o.coupon_id=c.id AND o.status <> 'cancelled') AS usage_count
    FROM coupons c WHERE c.code=$1 AND c.active=TRUE
      AND (c.starts_at IS NULL OR c.starts_at<=NOW()) AND (c.ends_at IS NULL OR c.ends_at>=NOW())
  `, [code]);
  const coupon = result.rows[0];
  if (!coupon) throw new ApiError(404, "Coupon is invalid or expired");
  if (subtotalPaise < coupon.minimum_order_paise) throw new ApiError(400, `Coupon requires a minimum order of ₹${Math.ceil(coupon.minimum_order_paise / 100)}`);
  if (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit) throw new ApiError(400, "Coupon usage limit has been reached");
  const discountPaise = coupon.discount_type === "percentage"
    ? Math.min(subtotalPaise, Math.floor(subtotalPaise * coupon.discount_value / 100))
    : Math.min(coupon.discount_value, subtotalPaise);
  response.json({ coupon: { code: coupon.code, discountPaise } });
}));

app.post("/api/newsletter", asyncRoute(async (request, response) => {
  const email = parseText(request.body?.email, "Email", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "A valid email is required");
  const result = await pool.query(`INSERT INTO newsletter_subscriptions (email) VALUES ($1)
    ON CONFLICT (email) DO NOTHING RETURNING id`, [email]);
  response.status(result.rowCount ? 201 : 200).json({ subscribed: true });
}));

app.post("/api/support", asyncRoute(async (request, response) => {
  const customer = await getCustomerSession(request);
  const name = parseText(request.body?.name || customer?.fullName, "Name", { min: 2, max: 100 });
  const email = parseText(request.body?.email || customer?.email, "Email", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "A valid email is required");
  const topic = parseText(request.body?.topic, "Topic", { min: 2, max: 100 });
  const message = parseText(request.body?.message, "Message", { min: 10, max: 4000 });
  const result = await pool.query(`
    INSERT INTO support_tickets(customer_id,name,email,topic,message) VALUES($1,$2,$3,$4,$5)
    RETURNING id, status, created_at AS "createdAt"
  `, [customer?.id || null, name, email, topic, message]);
  sendEmail({ to: email, subject: "We received your Buva enquiry", text: `Your support reference is ${result.rows[0].id}. We will reply soon.` });
  response.status(201).json({ ticket: result.rows[0] });
}));

app.post("/api/assistant", asyncRoute(async (request, response) => {
  const question = parseText(request.body?.question, "Question", { min: 2, max: 500 });
  const normalizedQuestion = question.trim().toLowerCase();
  if (/^(?:hi|hello|hey|good (?:morning|afternoon|evening))(?:\s+(?:buva|there))?[!?.\s]*$/.test(normalizedQuestion)) {
    return response.json({
      answer: "Hi! Welcome to BUVA. Tell me what kind of fragrance you like, such as floral, fresh or woody, and I can help you find one.",
      products: [],
      source: "assistant"
    });
  }
  // Price, stock, notes and gift answers must use current catalogue rows, not
  // the separately indexed RAG documents, which can lag behind inventory edits.
  const commerceQuestion = /\b(product|fragrance|perfume|scent|note|price|cost|stock|available|buy|gift|set|discovery|recommend|suggest|jasmine|vetiver|oud|rose|mist|floral|fresh|woody|rupee|ingredient|certification)s?\b|₹/i.test(question);
  if (commerceQuestion) {
    const result = await pool.query(`${productSelect}
      WHERE p.active=TRUE AND c.active=TRUE ORDER BY p.featured DESC, p.name LIMIT 100`);
    const words = normalizedQuestion.match(/[a-z]{3,}/g) || [];
    const ignored = new Set(["what", "which", "where", "when", "does", "with", "have", "the", "and", "for", "buva", "fragrance", "fragrances", "perfume", "perfumes", "scent", "notes", "note", "price", "cost", "much", "tell", "about", "recommend", "recommendations", "suggest", "suggestions", "best", "gift", "gifts", "idea", "ideas", "products", "product", "options", "available", "stock", "please", "show", "under", "below", "less", "than", "all", "list", "count", "many", "how", "rupees", "rupee", "ingredient", "ingredients", "certification", "certifications", "looking", "want", "need", "choose", "someone", "something", "you", "can"]);
    const terms = words.filter((word) => !ignored.has(word));
    let products = result.rows;
    if (/\b(gifts?|sets?|discovery)\b/.test(normalizedQuestion)) products = products.filter((product) => product.scentFamily === "sets");
    const budgetMatch = /(?:under|below|less than)\s*₹?\s*([\d,]+)/.exec(normalizedQuestion);
    if (budgetMatch) {
      const maxPaise = Number(budgetMatch[1].replaceAll(",", "")) * 100;
      if (Number.isSafeInteger(maxPaise)) products = products.filter((product) => product.pricePaise <= maxPaise);
    }
    if (/\b(in stock|available now)\b/.test(normalizedQuestion)) products = products.filter((product) => product.availableQuantity > 0);
    const scored = products.map((product) => {
      const name = product.name.toLowerCase();
      const details = `${product.shortDescription || ""} ${product.description || ""} ${product.scentFamily}`.toLowerCase();
      return { product, score: terms.reduce((score, term) => score + (name.includes(term) ? 3 : 0) + (details.includes(term) ? 1 : 0), 0) };
    }).sort((a, b) => b.score - a.score);
    const matches = terms.length ? scored.filter((entry) => entry.score > 0).slice(0, 3).map((entry) => entry.product) : products.slice(0, 3);
    if (/\b(how many|count)\b/.test(normalizedQuestion) && !terms.length) {
      return response.json({ answer: `The current BUVA catalogue has ${products.length} matching products.`, products: [], source: "catalogue" });
    }
    const answer = matches.length ? matches.map((product) => {
      const details = product.shortDescription || product.description;
      const availability = product.availableQuantity > 0 ? "available" : "currently sold out";
      return `${product.name}: ${details ? `${details.replace(/[.!?]+$/, "")}. ` : ""}${product.concentration}, ${product.sizeMl} ml, ${formatAssistantPrice(product.pricePaise)}, ${availability}.`;
    }).join(" ") : "I could not find a matching item in the current BUVA catalogue.";
    return response.json({ answer, products: matches, source: "catalogue" });
  }
  if (ragApiUrl) {
    try {
      const upstream = await fetch(`${ragApiUrl}/ask?q=${encodeURIComponent(question)}`, {
        headers: { Accept: "application/json", ...(ragApiToken ? { "X-RAG-Token": ragApiToken } : {}) },
        signal: AbortSignal.timeout(8_000)
      });
      const payload = await upstream.json();
      if (upstream.ok && typeof payload.answer === "string" && payload.answer.trim()) {
        return response.json({ answer: payload.answer.trim(), products: [], source: "rag" });
      }
    } catch (error) {
      console.warn("RAG assistant unavailable; using catalogue recommendations", error.message);
    }
  }
  const terms = question.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2).slice(0, 8);
  if (terms.length === 0) {
    return response.json({
      answer: "Tell me a scent, mood or budget you have in mind, and I can help you find a BUVA fragrance.",
      products: [],
      source: "catalogue"
    });
  }
  const result = await pool.query(`
    ${productSelect}
    WHERE p.active=TRUE AND c.active=TRUE
      AND ($1::TEXT[] = '{}' OR EXISTS (
        SELECT 1 FROM unnest($1::TEXT[]) term
        WHERE p.name ILIKE '%'||term||'%' OR COALESCE(p.description,'') ILIKE '%'||term||'%'
          OR p.scent_family ILIKE '%'||term||'%' OR p.concentration ILIKE '%'||term||'%'
      ))
    ORDER BY p.featured DESC, p.id LIMIT 3
  `, [terms]);
  const products = result.rows;
  const answer = products.length
    ? `You may enjoy ${products.map((product) => `${product.name} (${product.scentFamily}, ${formatAssistantPrice(product.pricePaise)})`).join(", ")}. Open the shop to compare them or add one to your wishlist.`
    : "I could not find an exact match. Try a mood or note such as floral, fresh, woody, jasmine, vetiver or oud.";
  response.json({ answer, products, source: "catalogue" });
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
        ? Math.min(subtotalPaise, Math.floor(subtotalPaise * coupon.discount_value / 100))
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

    await createInvoiceForOrder(client, {
      id: createdOrder.id,
      orderNumber: createdOrder.order_number,
      customerId: customer?.id || null,
      customerName: checkout.customerName,
      email: checkout.email,
      phone: checkout.phone,
      billingAddress: checkout.shippingAddress,
      subtotalPaise,
      discountPaise,
      shippingPaise,
      totalPaise,
      issuedAt: createdOrder.created_at
    });

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

  sendEmail(orderConfirmationEmail(result.order));

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

  const verification = await withTransaction(async (client) => {
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
    if (record.payment_record_status === 'refunded' || record.payment_status === 'refunded') {
      throw new ApiError(409, 'A refunded payment cannot be confirmed again');
    }

    await client.query(`
      UPDATE payments
      SET provider_payment_id = $2, status = 'captured', provider_payload = $3::JSONB
      WHERE id = $1
    `, [record.payment_id, paymentId, JSON.stringify(providerPayment)]);
    const paidOrder = await client.query(`
      UPDATE orders
      SET payment_status = 'paid'
      WHERE id = $1
      RETURNING payment_status
    `, [record.id]);

    return {
      notifyPaid: record.payment_record_status !== 'captured',
      order: {
        id: record.id,
        orderNumber: record.order_number,
        status: record.status,
        paymentMethod: "razorpay",
        paymentStatus: paidOrder.rows[0].payment_status,
        totalPaise: record.total_paise,
        customerName: record.customer_name,
        email: record.email,
        shippingAddress: record.shipping_address
      }
    };
  });

  if (verification.notifyPaid) await sendEmail(paymentConfirmationEmail(verification.order));
  response.json({ verified: true, order: verification.order });
}));

const processRazorpayWebhook = async (eventId, event) => {
  const paymentEntity = event?.payload?.payment?.entity;
  if (!paymentEntity?.order_id) return;
  const confirmedOrder = await withTransaction(async (client) => {
    const inserted = await client.query(`
      INSERT INTO razorpay_webhook_events (event_id, event_type)
      VALUES ($1, $2)
      ON CONFLICT (event_id) DO NOTHING
    `, [eventId, String(event.event || "unknown")]);
    if (inserted.rowCount === 0) return null;

    const paymentResult = await client.query(`
      SELECT p.id, p.order_id, p.status, p.amount_paise,
        o.order_number, o.customer_name, o.email, o.total_paise
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.provider = 'razorpay' AND p.provider_order_id = $1
      FOR UPDATE OF p, o
    `, [paymentEntity.order_id]);
    if (paymentResult.rowCount === 0) return null;
    const payment = paymentResult.rows[0];

    if (event.event === "payment.captured") {
      if (paymentEntity.status !== 'captured'
        || !paymentEntity.id
        || Number(paymentEntity.amount) !== payment.amount_paise
        || paymentEntity.currency !== 'INR') {
        throw new Error('Razorpay capture payload does not match the order');
      }
      if (payment.status === 'captured' || payment.status === 'refunded') return null;
      await client.query(`
        UPDATE payments SET provider_payment_id = $2, status = 'captured', provider_payload = $3::JSONB WHERE id = $1
      `, [payment.id, paymentEntity.id, JSON.stringify(paymentEntity)]);
      const paidOrder = await client.query(`
        UPDATE orders SET payment_status = 'paid' WHERE id = $1 RETURNING payment_status
      `, [payment.order_id]);
      return {
        orderNumber: payment.order_number,
        customerName: payment.customer_name,
        email: payment.email,
        paymentMethod: 'razorpay',
        paymentStatus: paidOrder.rows[0].payment_status,
        totalPaise: payment.total_paise
      };
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
    return null;
  });
  if (confirmedOrder) await sendEmail(paymentConfirmationEmail(confirmedOrder));
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
const scentFamilies = new Set(["floral", "fresh", "woody", "mist", "sets"]);

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

app.post(
  "/api/admin/upload-image",
  uploadProductImages.single("image"),
  asyncRoute(async (request, response) => {
    if (!request.file) {
      throw new ApiError(400, "Image file is required");
    }

    response.status(201).json({
      url: `/uploads/${request.file.filename}`,
      filename: request.file.filename,
      mimetype: request.file.mimetype,
      size: request.file.size
    });
  })
);

const getAdminProduct = async (productId, client = pool) => {
  const result = await client.query(`${adminProductSelect} WHERE p.id = $1`, [productId]);
  return result.rows[0] || null;
};

app.get("/api/admin/customers", asyncRoute(async (request, response) => {
  const search = typeof request.query.search === "string"
    ? request.query.search.trim().slice(0, 100)
    : "";

  const values = [];
  const filters = [];

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(
      c.full_name ILIKE $1
      OR c.email ILIKE $1
      OR COALESCE(c.phone, '') ILIKE $1
    )`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const result = await pool.query(`
    SELECT
      c.id,
      c.full_name AS "fullName",
      c.email,
      c.phone,
      c.active,
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt",
      COUNT(o.id)::INTEGER AS "orderCount",
      COALESCE(
        SUM(
          CASE
            WHEN o.status NOT IN ('cancelled', 'returned')
            THEN o.total_paise
            ELSE 0
          END
        ),
        0
      )::INTEGER AS "totalSpentPaise"
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    ${whereClause}
    GROUP BY
      c.id,
      c.full_name,
      c.email,
      c.phone,
      c.active,
      c.created_at,
      c.updated_at
    ORDER BY c.created_at DESC
    LIMIT 100
  `, values);

  response.json({
    customers: result.rows
  });
}));

app.get("/api/admin/customers/:customerId", asyncRoute(async (request, response) => {
  const customerId = request.params.customerId;

  const customerResult = await pool.query(`
    SELECT
      c.id,
      c.full_name AS "fullName",
      c.email,
      c.phone,
      c.active,
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt"
    FROM customers c
    WHERE c.id = $1
  `, [customerId]);

  const customer = customerResult.rows[0];

  if (!customer) {
    throw new ApiError(404, "Customer not found");
  }

  const addressResult = await pool.query(`
    SELECT
      id,
      label,
      recipient_name AS "recipientName",
      phone,
      line1,
      line2,
      city,
      state,
      postal_code AS "postalCode",
      country_code AS "countryCode",
      is_default AS "isDefault",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM addresses
    WHERE customer_id = $1
    ORDER BY is_default DESC, created_at DESC
  `, [customerId]);

  const orderResult = await pool.query(`
    SELECT
      id,
      order_number AS "orderNumber",
      customer_name AS "customerName",
      email,
      phone,
      status,
      payment_method AS "paymentMethod",
      payment_status AS "paymentStatus",
      subtotal_paise AS "subtotalPaise",
      discount_paise AS "discountPaise",
      shipping_paise AS "shippingPaise",
      total_paise AS "totalPaise",
      customer_notes AS "customerNotes",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM orders
    WHERE customer_id = $1
    ORDER BY created_at DESC
  `, [customerId]);

  const orders = orderResult.rows;

  const summary = orders.reduce(
    (acc, order) => {
      acc.orderCount += 1;

      if (!["cancelled", "returned"].includes(order.status)) {
        acc.totalSpentPaise += Number(order.totalPaise || 0);
      }

      return acc;
    },
    {
      orderCount: 0,
      totalSpentPaise: 0
    }
  );

  response.json({
    customer,
    addresses: addressResult.rows,
    orders,
    summary
  });
}));

app.patch("/api/admin/customers/:customerId/status", asyncRoute(async (request, response) => {
  const customerId = request.params.customerId;
  const active = request.body?.active;

  if (typeof active !== "boolean") {
    throw new ApiError(400, "active must be true or false");
  }

  const result = await pool.query(`
    UPDATE customers
    SET
      active = $1,
      updated_at = NOW()
    WHERE id = $2
    RETURNING
      id,
      full_name AS "fullName",
      email,
      phone,
      active,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `, [active, customerId]);

  if (!result.rows[0]) {
    throw new ApiError(404, "Customer not found");
  }

  response.json({
    customer: result.rows[0]
  });
}));

app.get("/api/admin/catalog/categories", asyncRoute(async (_request, response) => {
  const result = await pool.query(`
    SELECT slug, name, active
    FROM categories
    ORDER BY display_order, name
  `);
  response.json({ categories: result.rows });
}));

app.get("/api/admin/banners", asyncRoute(async (_request, response) => {
  const result = await pool.query(`SELECT id,title,subtitle,image_url AS "imageUrl",link_url AS "linkUrl",placement,
    display_order AS "displayOrder",active,starts_at AS "startsAt",ends_at AS "endsAt"
    FROM banners ORDER BY placement,display_order,id`);
  response.json({ banners: result.rows });
}));

const parseBanner = (body = {}) => {
  const imageUrl = parseText(body.imageUrl, "Banner image", { max: 500, optional: true });
  const linkUrl = parseText(body.linkUrl, "Banner link", { max: 500, optional: true });
  const safeUrl = (value) => !value || value.startsWith("/") || /^https:\/\//i.test(value) || /^[a-z0-9][a-z0-9/_-]*\.html(?:[?#].*)?$/i.test(value);
  if (!safeUrl(imageUrl) || !safeUrl(linkUrl)) throw new ApiError(400, "Banner URLs must be relative paths or use HTTPS");
  return {
    title: parseText(body.title, "Banner title", { min: 2, max: 160 }),
    subtitle: parseText(body.subtitle, "Banner subtitle", { max: 300, optional: true }),
    imageUrl,
    linkUrl,
    placement: ["home", "shop"].includes(body.placement) ? body.placement : "home",
    displayOrder: Number.isInteger(Number(body.displayOrder)) ? Number(body.displayOrder) : 0,
    active: body.active !== false,
    startsAt: body.startsAt || null,
    endsAt: body.endsAt || null
  };
};

app.post("/api/admin/banners", asyncRoute(async (request, response) => {
  const banner = parseBanner(request.body);
  const result = await pool.query(`INSERT INTO banners(title,subtitle,image_url,link_url,placement,display_order,active,starts_at,ends_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, Object.values(banner));
  response.status(201).json({ id: result.rows[0].id });
}));

app.patch("/api/admin/banners/:id", asyncRoute(async (request, response) => {
  const banner = parseBanner(request.body);
  const result = await pool.query(`UPDATE banners SET title=$2,subtitle=$3,image_url=$4,link_url=$5,placement=$6,
    display_order=$7,active=$8,starts_at=$9,ends_at=$10,updated_at=NOW() WHERE id=$1 RETURNING id`,
  [request.params.id, ...Object.values(banner)]);
  if (!result.rows[0]) throw new ApiError(404, "Banner not found");
  response.json({ id: result.rows[0].id });
}));

app.get("/api/admin/coupons", asyncRoute(async (_request, response) => {
  const result = await pool.query(`SELECT id,code,discount_type AS "discountType",discount_value AS "discountValue",
    minimum_order_paise AS "minimumOrderPaise",usage_limit AS "usageLimit",starts_at AS "startsAt",ends_at AS "endsAt",active
    FROM coupons ORDER BY created_at DESC`);
  response.json({ coupons: result.rows });
}));

const parseCoupon = (body = {}) => {
  const discountType = body.discountType;
  if (!["percentage", "fixed"].includes(discountType)) throw new ApiError(400, "Invalid discount type");
  const discountValue = Number(body.discountValue);
  if (!Number.isInteger(discountValue) || discountValue < 1 || (discountType === "percentage" && discountValue > 100)) throw new ApiError(400, "Invalid discount value");
  const minimumOrderPaise = Number(body.minimumOrderPaise ?? 0);
  const usageLimit = body.usageLimit === null || body.usageLimit === "" || body.usageLimit === undefined ? null : Number(body.usageLimit);
  const startsAt = body.startsAt || null;
  const endsAt = body.endsAt || null;
  if (!Number.isSafeInteger(minimumOrderPaise) || minimumOrderPaise < 0) throw new ApiError(400, "Invalid minimum order amount");
  if (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1)) throw new ApiError(400, "Invalid usage limit");
  if ((startsAt && !Number.isFinite(Date.parse(startsAt))) || (endsAt && !Number.isFinite(Date.parse(endsAt))) || (startsAt && endsAt && Date.parse(startsAt) > Date.parse(endsAt))) throw new ApiError(400, "Invalid coupon validity dates");
  return {
    code: parseText(body.code, "Coupon code", { max: 40 }).toUpperCase(), discountType, discountValue,
    minimumOrderPaise, usageLimit, startsAt, endsAt, active: body.active !== false
  };
};

app.post("/api/admin/coupons", asyncRoute(async (request, response) => {
  const coupon = parseCoupon(request.body);
  const result = await pool.query(`INSERT INTO coupons(code,discount_type,discount_value,minimum_order_paise,usage_limit,starts_at,ends_at,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,code`, Object.values(coupon));
  response.status(201).json({ coupon: result.rows[0] });
}));

app.patch("/api/admin/coupons/:id", asyncRoute(async (request, response) => {
  const coupon = parseCoupon(request.body);
  const result = await pool.query(`UPDATE coupons SET code=$2,discount_type=$3,discount_value=$4,minimum_order_paise=$5,
    usage_limit=$6,starts_at=$7,ends_at=$8,active=$9,updated_at=NOW() WHERE id=$1 RETURNING id,code`,
  [request.params.id, ...Object.values(coupon)]);
  if (!result.rows[0]) throw new ApiError(404, "Coupon not found");
  response.json({ coupon: result.rows[0] });
}));

app.get("/api/admin/reviews", asyncRoute(async (request, response) => {
  const status = ["pending", "approved", "rejected"].includes(request.query.status) ? request.query.status : null;
  const result = await pool.query(`SELECT r.id,r.rating,r.review_text AS "reviewText",r.status,r.admin_note AS "adminNote",
    r.created_at AS "createdAt",p.name AS "productName",c.full_name AS "customerName",o.order_number AS "orderNumber"
    FROM product_reviews r JOIN products p ON p.id=r.product_id JOIN customers c ON c.id=r.customer_id
    JOIN orders o ON o.id=r.order_id WHERE ($1::TEXT IS NULL OR r.status=$1) ORDER BY r.created_at DESC LIMIT 100`, [status]);
  response.json({ reviews: result.rows });
}));

app.patch("/api/admin/reviews/:id", asyncRoute(async (request, response) => {
  const status = request.body?.status;
  if (!["approved", "rejected"].includes(status)) throw new ApiError(400, "Review status must be approved or rejected");
  const note = parseText(request.body?.adminNote, "Admin note", { max: 1000, optional: true });
  const result = await pool.query("UPDATE product_reviews SET status=$2,admin_note=$3,updated_at=NOW() WHERE id=$1 RETURNING id,status", [request.params.id,status,note]);
  if (!result.rows[0]) throw new ApiError(404, "Review not found");
  response.json({ review: result.rows[0] });
}));

app.get("/api/admin/support", asyncRoute(async (request, response) => {
  const status = ["open", "in_progress", "resolved"].includes(request.query.status) ? request.query.status : null;
  const result = await pool.query(`SELECT id,name,email,topic,message,status,admin_note AS "adminNote",
    customer_reply AS "customerReply",created_at AS "createdAt"
    FROM support_tickets WHERE ($1::TEXT IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 100`, [status]);
  response.json({ tickets: result.rows });
}));

app.patch("/api/admin/support/:id", asyncRoute(async (request, response) => {
  const status = request.body?.status;
  if (!["open", "in_progress", "resolved"].includes(status)) throw new ApiError(400, "Invalid support status");
  const note = parseText(request.body?.adminNote, "Admin note", { max: 2000, optional: true });
  const reply = parseText(request.body?.customerReply, "Customer reply", { max: 4000, optional: true });
  const result = await pool.query(`UPDATE support_tickets SET status=$2,admin_note=$3,
    customer_reply=COALESCE($4,customer_reply),updated_at=NOW() WHERE id=$1
    RETURNING id,status,email,customer_reply AS "customerReply"`, [request.params.id,status,note,reply]);
  if (!result.rows[0]) throw new ApiError(404, "Support ticket not found");
  const email = reply ? await sendEmail({
    to: result.rows[0].email,
    subject: `Buva support reply · ${result.rows[0].id}`,
    text: `We have replied to your Buva support request:\n\n${reply}\n\nReference: ${result.rows[0].id}`
  }) : { accepted: false, reason: "not_requested" };
  response.json({ ticket: result.rows[0], email });
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
app.get("/api/admin/return-requests", asyncRoute(async (request, response) => {
  const requestedStatus = typeof request.query.status === "string"
    ? request.query.status.toLowerCase()
    : "";

  const allowedStatuses = new Set(["pending", "approved", "rejected"]);

  if (requestedStatus && !allowedStatuses.has(requestedStatus)) {
    throw new ApiError(400, "Invalid return request status");
  }

  const search = typeof request.query.search === "string"
    ? request.query.search.trim().slice(0, 100)
    : "";

  const filters = [];
  const values = [];

  if (requestedStatus) {
    values.push(requestedStatus);
    filters.push(`rr.status = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(
      o.order_number ILIKE $${values.length}
      OR c.full_name ILIKE $${values.length}
      OR c.email ILIKE $${values.length}
    )`);
  }

  const result = await pool.query(`
    SELECT
      rr.id,
      rr.order_id AS "orderId",
      o.order_number AS "orderNumber",
      rr.customer_id AS "customerId",
      c.full_name AS "customerName",
      c.email AS "customerEmail",
      c.phone AS "customerPhone",
      o.total_paise AS "totalPaise",
      o.status AS "orderStatus",
      o.payment_method AS "paymentMethod",
      o.payment_status AS "paymentStatus",
      rr.reason,
      rr.customer_note AS "customerNote",
      rr.status,
      rr.admin_note AS "adminNote",
      rr.created_at AS "createdAt",
      rr.updated_at AS "updatedAt"
    FROM return_requests rr
    INNER JOIN orders o ON o.id = rr.order_id
    INNER JOIN customers c ON c.id = rr.customer_id
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY rr.created_at DESC
    LIMIT 100
  `, values);

  response.json({
    returnRequests: result.rows,
    meta: {
      count: result.rowCount,
      status: requestedStatus || null,
      search: search || null
    }
  });
}));
app.get("/api/admin/return-requests/:returnRequestId", asyncRoute(async (request, response) => {
  const returnRequestId = request.params.returnRequestId;

  const result = await pool.query(`
    SELECT
      rr.id,
      rr.order_id AS "orderId",
      o.order_number AS "orderNumber",
      rr.customer_id AS "customerId",
      c.full_name AS "customerName",
      c.email AS "customerEmail",
      c.phone AS "customerPhone",
      c.active AS "customerActive",
      o.total_paise AS "totalPaise",
      o.status AS "orderStatus",
      o.payment_method AS "paymentMethod",
      o.payment_status AS "paymentStatus",
      o.shipping_address AS "shippingAddress",
      rr.reason,
      rr.customer_note AS "customerNote",
      rr.status,
      rr.admin_note AS "adminNote",
      rr.created_at AS "createdAt",
      rr.updated_at AS "updatedAt"
    FROM return_requests rr
    INNER JOIN orders o ON o.id = rr.order_id
    INNER JOIN customers c ON c.id = rr.customer_id
    WHERE rr.id = $1
  `, [returnRequestId]);

  const returnRequest = result.rows[0];

  if (!returnRequest) {
    throw new ApiError(404, "Return request not found");
  }

  response.json({ returnRequest });
}));
app.patch("/api/admin/return-requests/:returnRequestId", asyncRoute(async (request, response) => {
  const returnRequestId = String(request.params.returnRequestId || "").trim();
  const requestedStatus = typeof request.body?.status === "string"
    ? request.body.status.toLowerCase()
    : "";
  const adminNote = parseText(request.body?.adminNote, "Admin note", {
    max: 1000,
    optional: true
  });

  if (!["approved", "rejected"].includes(requestedStatus)) {
    throw new ApiError(400, "Return request status must be approved or rejected");
  }

  const result = await withTransaction(async (client) => {
    const requestResult = await client.query(`
      SELECT
        rr.id,
        rr.order_id AS "orderId",
        rr.customer_id AS "customerId",
        rr.status,
        o.order_number AS "orderNumber",
        o.status AS "orderStatus",
        o.payment_method AS "paymentMethod",
        o.payment_status AS "paymentStatus"
      FROM return_requests rr
      INNER JOIN orders o ON o.id = rr.order_id
      WHERE rr.id = $1
      FOR UPDATE OF rr, o
    `, [returnRequestId]);

    if (requestResult.rowCount === 0) {
      throw new ApiError(404, "Return request not found");
    }

    const current = requestResult.rows[0];

    if (current.status !== "pending") {
      throw new ApiError(409, `Return request is already ${current.status}`);
    }

    if (requestedStatus === "approved") {
      if (current.orderStatus !== "delivered") {
        throw new ApiError(409, "Only a delivered order can have its return request approved");
      }

      if (
        current.paymentMethod === "razorpay"
        && current.paymentStatus === "paid"
      ) {
        throw new ApiError(
          409,
          "Refund the Razorpay payment before approving this return request"
        );
      }

      await client.query(`
        UPDATE orders
        SET status = 'returned'
        WHERE id = $1
      `, [current.orderId]);

      await client.query(`
        UPDATE inventory i
        SET quantity = i.quantity + returned.quantity,
            updated_at = NOW()
        FROM (
          SELECT product_id, SUM(quantity)::INTEGER AS quantity
          FROM order_items
          WHERE order_id = $1
            AND product_id IS NOT NULL
          GROUP BY product_id
        ) returned
        WHERE i.product_id = returned.product_id
      `, [current.orderId]);
    }

    const updatedResult = await client.query(`
      UPDATE return_requests
      SET
        status = $2,
        admin_note = $3,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        order_id AS "orderId",
        customer_id AS "customerId",
        reason,
        customer_note AS "customerNote",
        status,
        admin_note AS "adminNote",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `, [returnRequestId, requestedStatus, adminNote]);

    return {
      ...updatedResult.rows[0],
      orderNumber: current.orderNumber,
      orderStatus: requestedStatus === "approved" ? "returned" : current.orderStatus
    };
  });

  response.json({ returnRequest: result });
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

const orderExportHeadings = ["order_number","customer_name","email","phone","status","payment_method","payment_status",
  "subtotal_paise","discount_paise","shipping_paise","total_paise","courier_name","tracking_number","created_at"];

const getOrdersForExport = async (request) => {
  const from = typeof request.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.query.from) ? request.query.from : null;
  const to = typeof request.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.query.to) ? request.query.to : null;
  const result = await pool.query(`SELECT order_number,customer_name,email,phone,status,payment_method,payment_status,
    subtotal_paise,discount_paise,shipping_paise,total_paise,courier_name,tracking_number,created_at
    FROM orders WHERE ($1::DATE IS NULL OR created_at >= $1::DATE)
      AND ($2::DATE IS NULL OR created_at < $2::DATE + INTERVAL '1 day') ORDER BY created_at DESC`, [from,to]);
  return result.rows;
};

app.get("/api/admin/exports/orders.csv", asyncRoute(async (request, response) => {
  const rows = await getOrdersForExport(request);
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [orderExportHeadings.join(","), ...rows.map((row) => orderExportHeadings.map((key) => escapeCsv(row[key])).join(","))].join("\n");
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="buva-orders-${new Date().toISOString().slice(0,10)}.csv"`);
  response.send(`\uFEFF${csv}`);
}));

app.get("/api/admin/exports/orders.xlsx", asyncRoute(async (request, response) => {
  const rows = await getOrdersForExport(request);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = orderExportHeadings.map((key) => ({ header: key, key, width: Math.max(18, key.length + 3) }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: "A1", to: `N${Math.max(rows.length + 1, 2)}` };
  for (const row of rows) {
    sheet.addRow({ ...row, created_at: row.created_at ? new Date(row.created_at) : null });
  }
  sheet.getColumn("created_at").numFmt = "yyyy-mm-dd hh:mm";
  const buffer = await workbook.xlsx.writeBuffer();
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", `attachment; filename="buva-orders-${new Date().toISOString().slice(0,10)}.xlsx"`);
  response.send(Buffer.from(buffer));
}));

app.get("/api/admin/orders/:identifier", asyncRoute(async (request, response) => {
  const order = await getAdminOrder(request.params.identifier);
  if (!order) throw new ApiError(404, "Order not found");
  response.json({ order, allowedTransitions: [...allowedOrderTransitions[order.status]] });
}));

app.get("/api/admin/orders/:identifier/invoice", asyncRoute(async (request, response) => {
  const invoice = await getAdminInvoice(pool, request.params.identifier);
  if (!invoice) throw new ApiError(404, "Invoice not found");
  response.json({ invoice });
}));

app.patch("/api/admin/orders/:identifier/tracking", asyncRoute(async (request, response) => {
  const courierName = parseText(request.body?.courierName, "Courier", { min: 2, max: 100 });
  const trackingNumber = parseText(request.body?.trackingNumber, "Tracking number", { min: 2, max: 120 });
  const trackingUrl = parseText(request.body?.trackingUrl, "Tracking URL", { max: 500, optional: true });
  if (trackingUrl && !/^https:\/\//i.test(trackingUrl)) throw new ApiError(400, "Tracking URL must use HTTPS");
  const result = await pool.query(`UPDATE orders SET courier_name=$2,tracking_number=$3,tracking_url=$4,
    shipped_at=COALESCE(shipped_at,NOW()),updated_at=NOW() WHERE id::TEXT=$1 OR order_number=$1 RETURNING id`,
  [request.params.identifier,courierName,trackingNumber,trackingUrl]);
  if (!result.rows[0]) throw new ApiError(404, "Order not found");
  const order = await getAdminOrder(String(result.rows[0].id));
  response.json({ order, allowedTransitions: [...allowedOrderTransitions[order.status]] });
}));

app.patch("/api/admin/orders/:identifier/status", asyncRoute(async (request, response) => {
  const nextStatus = typeof request.body?.status === "string" ? request.body.status.toLowerCase() : "";
  if (!orderStatuses.has(nextStatus)) throw new ApiError(400, "Invalid order status");

  let statusChanged = false;
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
      if (
        current.payment_method === "razorpay"
        && current.payment_status !== "paid"
        && ["confirmed", "packed", "shipped", "delivered"].includes(nextStatus)
      ) {
        throw new ApiError(409, "Razorpay payment must be paid before fulfilling this order");
      }
      if ((nextStatus === "cancelled" || nextStatus === "returned")
        && current.payment_method === "razorpay"
        && current.payment_status === "paid") {
        throw new ApiError(409, "Refund the Razorpay payment before cancelling or returning this order");
      }
      await client.query(`UPDATE orders SET status = $2,
        shipped_at = CASE WHEN $2='shipped' THEN COALESCE(shipped_at,NOW()) ELSE shipped_at END,
        delivered_at = CASE WHEN $2='delivered' THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END
        WHERE id = $1`, [current.id, nextStatus]);
      statusChanged = true;

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

  if (statusChanged) {
    try {
      const preference = order.customerId
        ? await pool.query("SELECT order_updates FROM notification_preferences WHERE customer_id=$1", [order.customerId])
        : null;
      if (preference?.rows[0]?.order_updates !== false) {
        const title = `Buva order ${order.orderNumber} ${nextStatus}`;
        const tracking = nextStatus === "shipped" && order.trackingUrl ? ` Track your parcel: ${order.trackingUrl}` : "";
        const body = `Your order ${order.orderNumber} is now ${nextStatus}.${tracking}`;
        const results = await Promise.allSettled([
          order.email ? sendEmail({ to: order.email, subject: title, text: body }) : Promise.resolve(),
          sendOrderPush(order.customerId, title, body, order.orderNumber)
        ]);
        for (const result of results) if (result.status === "rejected") console.error("Order notification failed:", result.reason);
      }
    } catch (error) {
      console.error("Order notification failed:", error);
    }
  }

  response.json({ order, allowedTransitions: [...allowedOrderTransitions[order.status]] });
}));

app.use((error, _request, response, _next) => {
  if (error instanceof ApiError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error?.code === "23505") {
    return response.status(409).json({ error: "A record with this unique value already exists" });
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

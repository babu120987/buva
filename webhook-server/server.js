import express from "express";
import crypto from "crypto";

const app = express();

// If you will verify signatures, you often need raw body.
// For generic webhooks, JSON is fine:
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 9000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ""; // optional

function verifyHmac(req) {
  // Example for GitHub: header is "x-hub-signature-256"
  const sig = req.headers["x-hub-signature-256"];
  if (!WEBHOOK_SECRET || !sig) return { ok: false, reason: "no secret/signature" };

  const payload = JSON.stringify(req.body);
  const hmac = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  const ok = crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig));
  return { ok, reason: ok ? "verified" : "bad signature" };
}

app.post("/webhook", (req, res) => {
  const event = req.headers["x-github-event"] || req.headers["stripe-signature"] || "unknown";
  const id = req.headers["x-github-delivery"] || req.headers["x-request-id"] || "";

  // OPTIONAL signature check (GitHub example)
  const v = verifyHmac(req);

  console.log("=== WEBHOOK RECEIVED ===");
  console.log("event:", event, "id:", id);
  console.log("verify:", v);
  console.log("body:", req.body);

  // TODO: trigger Jenkins, write to file, call internal API, etc.
  return res.status(200).json({ ok: true });
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Webhook server listening on ${PORT}`));

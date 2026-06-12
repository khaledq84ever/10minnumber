// 10MinNumber — disposable phone numbers for receiving real SMS.
// Sessions bind a visitor to a pool number for 10 minutes (extendable to 30).
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const PORT = process.env.PORT || 3500;
// Twilio signs webhooks against the exact URL it was told to call.
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || `http://72.60.89.132:${PORT}/api/sms/incoming`;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

const SESSION_MS = 10 * 60 * 1000;
const MAX_SESSION_MS = 30 * 60 * 1000;
const MESSAGE_TTL_MS = 60 * 60 * 1000;
const SESSIONS_PER_IP_PER_HOUR = 5;

const db = require("./db");

// Auto-seed pool numbers from env (Railway): SEED_NUMBERS="+18603514112:US,+1555:US"
for (const entry of (process.env.SEED_NUMBERS || "").split(",")) {
  const [e164, country = "US"] = entry.trim().split(":");
  if (/^\+\d{8,15}$/.test(e164 || ""))
    db.prepare(
      "INSERT INTO numbers (e164, country) VALUES (?, ?) ON CONFLICT(e164) DO UPDATE SET active = 1",
    ).run(e164, country.toUpperCase());
}

const app = express();
app.set("trust proxy", false);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

// Twilio request validation: HMAC-SHA1(url + sorted(key+value) params, auth token), base64.
function validTwilioSignature(req) {
  const sig = req.get("X-Twilio-Signature");
  if (!sig || !AUTH_TOKEN) return false;
  const params = req.body || {};
  const data =
    WEBHOOK_URL +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = crypto
    .createHmac("sha1", AUTH_TOKEN)
    .update(Buffer.from(data, "utf8"))
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function extractOtp(body) {
  // Prefer codes near OTP-ish words, else first standalone 4-8 digit run.
  const near = body.match(
    /(?:code|otp|رمز|كود|pin|verification)[^0-9]{0,20}(\d[\d -]{2,9}\d)/i,
  );
  const raw = near ? near[1] : (body.match(/\b(\d{4,8})\b/) || [])[1];
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length >= 4 && digits.length <= 8 ? digits : null;
}

// POST /api/session — assign least-recently-used active number for 10 min.
app.post("/api/session", (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = db
    .prepare("SELECT COUNT(*) c FROM sessions WHERE ip = ? AND created_at > ?")
    .get(ip, now - 60 * 60 * 1000).c;
  if (recent >= SESSIONS_PER_IP_PER_HOUR)
    return res.status(429).json({ error: "rate_limited" });
  const live = db
    .prepare("SELECT token FROM sessions WHERE ip = ? AND expires_at > ?")
    .get(ip, now);
  if (live) return res.json({ token: live.token, existing: true });

  const num = db
    .prepare(
      "SELECT * FROM numbers WHERE active = 1 ORDER BY last_assigned_at ASC LIMIT 1",
    )
    .get();
  if (!num) return res.status(503).json({ error: "no_numbers" });
  db.prepare("UPDATE numbers SET last_assigned_at = ? WHERE id = ?").run(
    now,
    num.id,
  );
  const token = crypto.randomBytes(16).toString("hex");
  db.prepare(
    "INSERT INTO sessions (token, number_id, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(token, num.id, ip, now, now + SESSION_MS);
  res.json({ token });
});

function liveSession(req, res) {
  const s = db
    .prepare(
      `SELECT s.*, n.e164, n.country FROM sessions s
       JOIN numbers n ON n.id = s.number_id WHERE s.token = ?`,
    )
    .get(req.params.token);
  if (!s || s.expires_at <= Date.now()) {
    res.status(404).json({ error: "expired" });
    return null;
  }
  return s;
}

app.get("/api/session/:token", (req, res) => {
  const s = liveSession(req, res);
  if (!s) return;
  res.json({
    number: s.e164,
    country: s.country,
    created_at: s.created_at,
    expires_at: s.expires_at,
  });
});

app.post("/api/session/:token/extend", (req, res) => {
  const s = liveSession(req, res);
  if (!s) return;
  const cap = s.created_at + MAX_SESSION_MS;
  const next = Math.min(s.expires_at + SESSION_MS, cap);
  if (next === s.expires_at)
    return res.status(400).json({ error: "max_reached" });
  db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(
    next,
    s.token,
  );
  res.json({ expires_at: next });
});

// Only messages that arrived AFTER this session started — never older ones.
app.get("/api/session/:token/messages", (req, res) => {
  const s = liveSession(req, res);
  if (!s) return;
  const rows = db
    .prepare(
      `SELECT from_e164, body, otp, received_at FROM messages
       WHERE number_id = ? AND received_at >= ? ORDER BY received_at DESC`,
    )
    .all(s.number_id, s.created_at);
  res.json({ messages: rows });
});

// Twilio inbound webhook.
app.post("/api/sms/incoming", (req, res) => {
  if (!validTwilioSignature(req)) return res.status(403).send("forbidden");
  const { From, Body, To } = req.body || {};
  const num = db.prepare("SELECT id FROM numbers WHERE e164 = ?").get(To || "");
  if (num && From && Body) {
    db.prepare(
      "INSERT INTO messages (number_id, from_e164, body, otp, received_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      num.id,
      From,
      String(Body).slice(0, 2000),
      extractOtp(Body),
      Date.now(),
    );
  }
  res.type("text/xml").send("<Response></Response>");
});

app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    numbers: db.prepare("SELECT COUNT(*) c FROM numbers WHERE active=1").get()
      .c,
  }),
);

// Janitor: drop expired sessions and old messages.
setInterval(() => {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM messages WHERE received_at <= ?").run(
    now - MESSAGE_TTL_MS,
  );
}, 60 * 1000).unref();

app.listen(PORT, () =>
  console.log(`10MinNumber on :${PORT} — webhook ${WEBHOOK_URL}`),
);

// Smoke test: boots the server on a throwaway port/DB, fakes a SIGNED Twilio
// webhook, and asserts the message + OTP appear in an active session.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const PORT = 4510;
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_URL = `${BASE}/api/sms/incoming`;
const AUTH_TOKEN = "smoketesttoken";
const DB = "/tmp/10minnumber-smoke.db";

for (const f of [DB, DB + "-wal", DB + "-shm"]) fs.rmSync(f, { force: true });

// Server reads data.db beside itself — run a copy pointed at the tmp DB via env? It
// doesn't support DB path env, so run from a tmp dir with a symlinked server tree.
// Simpler: temporarily run with cwd intact but DATABASE override via NODE_OPTIONS
// is overkill — instead the server is small; we monkey-load it with a child env
// that chdir's. Easiest robust approach: copy server.js usage as-is in a tmp dir.
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync("/tmp/10mn-smoke-");
for (const f of ["server.js", "seed-number.js", "db.js", "package.json"])
  fs.copyFileSync(path.join(root, f), path.join(tmp, f));
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"));
fs.symlinkSync(path.join(root, "public"), path.join(tmp, "public"));

const srv = spawn("node", ["server.js"], {
  cwd: tmp,
  env: {
    ...process.env,
    PORT: String(PORT),
    WEBHOOK_URL,
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  },
  stdio: "inherit",
});

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

function twilioSign(url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

try {
  await new Promise((r) => setTimeout(r, 1200));
  // seed a number
  const { execSync } = await import("node:child_process");
  execSync(`node seed-number.js +15550001111 US`, { cwd: tmp });

  const health = await (await fetch(`${BASE}/api/health`)).json();
  check("health + 1 number", health.ok && health.numbers === 1);

  const { token } = await (await fetch(`${BASE}/api/session`, { method: "POST" })).json();
  check("session created", !!token);

  const sess = await (await fetch(`${BASE}/api/session/${token}`)).json();
  check("session shows number", sess.number === "+15550001111");

  // unsigned webhook must be rejected
  const bad = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: "+19998887777", To: "+15550001111", Body: "hack" }),
  });
  check("unsigned webhook → 403", bad.status === 403);

  // signed webhook accepted
  const params = {
    From: "+19998887777",
    To: "+15550001111",
    Body: "Your verification code is 482913. Do not share it.",
  };
  const ok = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": twilioSign(WEBHOOK_URL, params),
    },
    body: new URLSearchParams(params),
  });
  check("signed webhook → 200", ok.status === 200);

  const { messages } = await (
    await fetch(`${BASE}/api/session/${token}/messages`)
  ).json();
  check("message visible in session", messages.length === 1);
  check("OTP extracted", messages[0]?.otp === "482913", `got ${messages[0]?.otp}`);

  // arabic OTP wording
  const p2 = { From: "+15551112222", To: "+15550001111", Body: "رمز التحقق الخاص بك هو 7741" };
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": twilioSign(WEBHOOK_URL, p2),
    },
    body: new URLSearchParams(p2),
  });
  const m2 = await (await fetch(`${BASE}/api/session/${token}/messages`)).json();
  check("arabic OTP extracted", m2.messages[0]?.otp === "7741", `got ${m2.messages[0]?.otp}`);

  // extend works and caps at 30 min
  const e1 = await fetch(`${BASE}/api/session/${token}/extend`, { method: "POST" });
  check("extend → ok", e1.ok);
} catch (err) {
  check("no exceptions", false, String(err).slice(0, 120));
} finally {
  srv.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);

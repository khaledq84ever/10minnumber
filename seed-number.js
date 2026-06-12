// Usage: node seed-number.js +18603514112 US
const db = require("./db");
const [e164, country = "US"] = process.argv.slice(2);
if (!/^\+\d{8,15}$/.test(e164 || "")) {
  console.error("Usage: node seed-number.js +1XXXXXXXXXX [US]");
  process.exit(1);
}
db.prepare(
  "INSERT INTO numbers (e164, country) VALUES (?, ?) ON CONFLICT(e164) DO UPDATE SET active = 1, country = excluded.country",
).run(e164, country.toUpperCase());
console.log("seeded", e164, country.toUpperCase());

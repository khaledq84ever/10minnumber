# 10MinNumber 📱

Disposable phone numbers for receiving real SMS — like 10-minute mail, but for phone verification codes.

**Live:** https://10minnumber-production.up.railway.app

## How it works

- Visitor gets a number from the pool for **10 minutes** (extendable to 30).
- Incoming SMS hit a **Twilio webhook** (signature-validated) and appear on screen within seconds.
- Verification codes are **auto-extracted** (English + Arabic wording) with one-tap copy.
- Sessions only see messages that arrived **after** they started — never another visitor's.
- Arabic-first RTL UI with English toggle, mobile-first.

## Stack

Node.js + Express + better-sqlite3, vanilla JS frontend. No accounts, no tracking.

## Run it

```bash
npm install
cp .env.example .env        # fill TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
node seed-number.js +1XXXXXXXXXX US
npm start                   # :3500
npm test                    # 9-check smoke suite (signed webhook, OTP extraction, expiry)
```

Point your Twilio number's SMS webhook at `<your-url>/api/sms/incoming` — it must exactly match `WEBHOOK_URL` (signature validation). On Railway, set `SEED_NUMBERS="+1XXXXXXXXXX:US"` and `DB_PATH=/data/data.db` with a `/data` volume.

---
Programmed by [@KhaledQ84Ever](https://x.com/KhaledQ84Ever)

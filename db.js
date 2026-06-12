// Shared DB handle + schema — used by server.js and seed-number.js.
const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH || path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  e164 TEXT UNIQUE NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  active INTEGER NOT NULL DEFAULT 1,
  last_assigned_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  number_id INTEGER NOT NULL REFERENCES numbers(id),
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number_id INTEGER NOT NULL REFERENCES numbers(id),
  from_e164 TEXT NOT NULL,
  body TEXT NOT NULL,
  otp TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_number_time ON messages(number_id, received_at);
`);

module.exports = db;

// db.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'orders.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    rowid_pk INTEGER PRIMARY KEY AUTOINCREMENT,
    "Order" TEXT UNIQUE,
    "Customer PO" TEXT,
    "_1" TEXT,
    "Planned Delivery Date" TEXT,
    "Carrier/LSP" TEXT,
    "Status" TEXT DEFAULT 'OPEN'
  );
`);


module.exports = db;
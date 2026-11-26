// Local ledger of swaps, so an interrupted swap can be reconciled later.
const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(process.env.SWAP_DB || path.join(__dirname, "..", "swaps.db"));

db.exec(`CREATE TABLE IF NOT EXISTS swaps (
  reference    TEXT PRIMARY KEY,
  order_id     TEXT,
  quote_id     TEXT,
  from_ccy     TEXT NOT NULL,
  to_ccy       TEXT NOT NULL,
  quantity     TEXT NOT NULL,
  price        TEXT,
  receive_qty  TEXT,
  status       TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
)`);

const stmts = {
  insert: db.prepare(`INSERT INTO swaps (reference, quote_id, from_ccy, to_ccy, quantity, price, receive_qty, status)
                      VALUES (@reference, @quote_id, @from_ccy, @to_ccy, @quantity, @price, @receive_qty, 'pending')`),
  update: db.prepare(`UPDATE swaps SET order_id = COALESCE(@order_id, order_id), status = @status,
                      updated_at = datetime('now') WHERE reference = @reference`),
  pending: db.prepare(`SELECT * FROM swaps WHERE status = 'pending'`),
};

module.exports = {
  insert: (row) => stmts.insert.run(row),
  update: ({ reference, order_id = null, status }) => stmts.update.run({ reference, order_id, status }),
  pending: () => stmts.pending.all(),
};

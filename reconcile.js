// Resolve swaps still marked pending in the local ledger.
const ledger = require("./lib/db");
const { confirmOrder } = require("./lib/confirm");

(async () => {
  const rows = ledger.pending();
  if (!rows.length) return console.log("Nothing pending");
  for (const row of rows) {
    const ngn = row.from_ccy === "NGN" || row.to_ccy === "NGN";
    // NGN orders can't be looked up by reference, only by id.
    const key = ngn ? row.order_id : row.reference;
    if (!key) {
      console.log(`${row.reference}: NGN order with no id; resend the order with the same reference to recover it`);
      continue;
    }
    try {
      const o = await confirmOrder(key, { timeoutMs: 10_000 });
      ledger.update({ reference: row.reference, order_id: o.id, status: o.status });
      console.log(`${row.reference} -> ${o.status}`);
    } catch (e) {
      console.log(`${row.reference} still unresolved: ${e.message}`);
    }
  }
})();

// Poll an order until it reaches a final status.
// Crypto orders: look up by reference. NGN orders: look up by order id.
const bitnob = require("./bitnob");

const FINAL = new Set(["filled", "rejected", "cancelled", "failed"]);

async function confirmOrder(key, { timeoutMs = 60_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { data: { order } } = await bitnob.getOrder(key);
      if (FINAL.has(order.status)) return order;
    } catch (e) {
      if (e.status && e.status !== 404) throw e; // a real API error
      // 404 or a network blip: try again
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Order ${key} not final after ${timeoutMs / 1000}s`);
}

module.exports = { FINAL, confirmOrder };

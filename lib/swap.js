// One swap: quote, order, confirm.
const crypto = require("crypto");
const bitnob = require("./bitnob");
const { buildTrade } = require("./pairs");
const { confirmOrder } = require("./confirm");

async function swap(from, to, amount, { ledger, log = console.log } = {}) {
  const { trade, ngn } = buildTrade(from, to, amount);
  // Create the reference before the first attempt, so a retry can reuse it.
  const reference = `swap-${crypto.randomUUID()}`;

  // 1. Quote
  const { data: { quote } } = await bitnob.createQuote(trade);
  const x = quote.exchange;
  const msLeft = new Date(quote.expires_at) - Date.now();
  log(`Quote ${quote.id}: send ${x.send_quantity} ${x.send_currency} -> receive ${x.receive_quantity} ${x.receive_currency} (expires in ${Math.round(msLeft / 1000)}s)`);
  if (msLeft <= 0) throw new Error("Quote expired; fetch a new one");

  const order = { ...trade, price: quote.price, quote_id: quote.id, reference };
  ledger?.insert({
    reference, quote_id: quote.id, from_ccy: trade.base_currency, to_ccy: trade.quote_currency,
    quantity: trade.quantity, price: quote.price, receive_qty: x.receive_quantity,
  });

  // 2. Order
  let placed;
  try {
    placed = (await bitnob.submitOrder(order)).data.order;
  } catch (e) {
    if (e.status) {
      ledger?.update({ reference, status: "rejected" }); // the API said no: no funds moved
      throw e;
    }
    if (ngn) {
      log("No response; resending with the same reference (safe on NGN pairs)...");
      placed = (await bitnob.submitOrder(order)).data.order;
    } else {
      log("No response; looking the order up by reference (resending could trade twice)...");
      placed = await confirmOrder(reference);
    }
  }

  // 3. Confirm
  const final = placed.status === "filled" ? placed : await confirmOrder(ngn ? placed.id : reference);
  ledger?.update({ reference, order_id: final.id, status: final.status });
  log(`Order ${final.id} [${reference}] status=${final.status}`);
  if (final.status !== "filled") throw new Error(`Order ${final.status}`);

  return { reference, quote, order: final, ngn };
}

module.exports = { swap };

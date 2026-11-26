// Live sandbox suite: every direction, then the failure cases.
// Run: npm run test:sandbox   (moves sandbox funds only; refuses a production secret by default)
process.env.SWAP_DB ||= require("path").join(__dirname, "results", "sandbox.db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });

const bitnob = require("../lib/bitnob");
const ledger = require("../lib/db");
const { swap } = require("../lib/swap");
const { allDirections } = require("../lib/pairs");

// Crypto pairs have higher minimums (0.0001 BTC, 10 USDT) than NGN pairs (₦500 on the NGN side).
const AMOUNTS = {
  crypto: { BTC: "0.0001", USDT: "10", USDC: "10" },
  ngn: { BTC: "0.00003", USDT: "2", USDC: "2", NGN: "500" },
};
const ONLY = process.env.ONLY; // "crypto" or "ngn" to run one half
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = () => `test-${crypto.randomUUID()}`;
const errOf = (e) => ({ status: e.status ?? null, code: e.code ?? null, detail: e.detail ?? e.message });

async function balances(...cs) {
  const out = {};
  for (const c of cs) out[c] = BigInt((await bitnob.getBalance(c)).data.available_balance);
  return out;
}

async function quoteFor(from, to, quantity) {
  return (await bitnob.createQuote({ base_currency: from, quote_currency: to, side: "sell", quantity })).data.quote;
}

const results = { started_at: new Date().toISOString(), directions: [], cases: [] };

async function directions() {
  for (const [from, to] of allDirections()) {
    const kind = from === "NGN" || to === "NGN" ? "ngn" : "crypto";
    if (ONLY && ONLY !== kind) continue;
    const amount = AMOUNTS[kind][from];
    const row = { from, to, amount };
    try {
      const before = await balances(from, to);
      const t0 = Date.now();
      const { reference, quote, order, ngn } = await swap(from, to, amount, { ledger, log: () => {} });
      const after = await balances(from, to);
      Object.assign(row, {
        ok: true,
        quote_ttl_s: Math.round((new Date(quote.expires_at) - new Date(quote.created_at)) / 1000),
        send: quote.exchange.send_quantity,
        receive: quote.exchange.receive_quantity,
        status: order.status,
        ms: Date.now() - t0,
        delta_from_minor: (after[from] - before[from]).toString(),
        delta_to_minor: (after[to] - before[to]).toString(),
      });
      // Which lookups work for this order?
      for (const [k, key] of [["by_reference", reference], ["by_id", order.id]]) {
        try { row[`lookup_${k}`] = (await bitnob.getOrder(key)).data.order.status; }
        catch (e) { row[`lookup_${k}`] = `${e.status}`; }
      }
      row.ngn = ngn;
    } catch (e) {
      Object.assign(row, { ok: false, error: errOf(e) });
    }
    console.log(`${row.ok ? "PASS" : "FAIL"} ${from}->${to} ${amount}`, row.ok ? `recv ${row.receive}` : JSON.stringify(row.error));
    results.directions.push(row);
  }
}

async function runCase(name, expect, fn) {
  const c = { name, expect };
  try { c.result = await fn(); c.outcome = "ok"; }
  catch (e) { c.outcome = "error"; c.error = errOf(e); }
  console.log(`CASE ${name}: ${c.outcome}`, JSON.stringify(c.error || c.result));
  results.cases.push(c);
}

// Buy enough USDT/USDC with sandbox NGN to cover the crypto runs.
async function topUp() {
  const need = { USDT: 70_000_000n, USDC: 25_000_000n }; // minor units
  for (const [c, min] of Object.entries(need)) {
    const have = (await balances(c))[c];
    if (have >= min) continue;
    await swap("NGN", c, "40000", { ledger, log: () => {} });
    console.log(`Topped up ${c} with ₦40,000`);
  }
}

const crypto_ = () => !ONLY || ONLY === "crypto";
const ngn_ = () => !ONLY || ONLY === "ngn";

async function cases() {
  if (ngn_()) await runCase("NGN below minimum (₦499 quote)", "400 INVALID_AMOUNT", () => quoteFor("NGN", "USDT", "499"));

  if (crypto_()) await runCase("Crypto below minimum (5 USDT -> USDC quote)", "400, detail names the minimum", async () => {
    const q = await quoteFor("USDT", "USDC", "5");
    const o = await bitnob.submitOrder({ base_currency: "USDT", quote_currency: "USDC", side: "sell", quantity: "5", price: q.price, quote_id: q.id, reference: ref() });
    return { quote_ok: true, status: o.data.order.status };
  });

  if (crypto_()) await runCase("Insufficient balance (100000 USDC -> USDT)", "422", async () => {
    const q = await quoteFor("USDC", "USDT", "100000");
    const o = await bitnob.submitOrder({ base_currency: "USDC", quote_currency: "USDT", side: "sell", quantity: "100000", price: q.price, quote_id: q.id, reference: ref() });
    return { quote_ok: true, status: o.data.order.status };
  });

  if (ngn_()) await runCase("Insufficient balance, NGN (₦9,000,000 -> USDT quote)", "error at quote", () => quoteFor("NGN", "USDT", "9000000"));

  if (crypto_()) await runCase("Unsupported pair (USDT -> GHS quote)", "400", () => quoteFor("USDT", "GHS", "1"));

  if (ngn_()) await runCase("Expired NGN quote (order after expires_at)", "422 PRECONDITION_FAILED", async () => {
    const q = await quoteFor("NGN", "USDT", "500");
    await sleep(Math.max(0, new Date(q.expires_at) - Date.now()) + 3000);
    const o = await bitnob.submitOrder({ base_currency: "NGN", quote_currency: "USDT", side: "sell", quantity: "500", price: q.price, quote_id: q.id, reference: ref() });
    return { status: o.data.order.status, id: o.data.order.id };
  });

  if (ngn_()) await runCase("Repeated reference, NGN (same order sent twice)", "second returns the original order", async () => {
    const q = await quoteFor("NGN", "USDT", "500");
    const body = { base_currency: "NGN", quote_currency: "USDT", side: "sell", quantity: "500", price: q.price, quote_id: q.id, reference: ref() };
    const a = (await bitnob.submitOrder(body)).data.order;
    let b;
    try { b = (await bitnob.submitOrder(body)).data.order; } catch (e) { return { first: a.id, second_error: errOf(e) }; }
    return { first: a.id, second: b.id, same: a.id === b.id };
  });

  if (crypto_()) await runCase("Repeated reference, crypto (same order sent twice)", "can trade twice", async () => {
    const q = await quoteFor("USDT", "USDC", "10");
    const body = { base_currency: "USDT", quote_currency: "USDC", side: "sell", quantity: "10", price: q.price, quote_id: q.id, reference: ref() };
    const a = (await bitnob.submitOrder(body)).data.order;
    let b;
    try { b = (await bitnob.submitOrder(body)).data.order; } catch (e) { return { first: a.id, second_error: errOf(e) }; }
    return { first: a.id, second: b.id, same: a.id === b.id };
  });

  if (crypto_()) await runCase("Repeated reference, crypto, fresh quote each time", "can trade twice", async () => {
    const r = ref();
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const q = await quoteFor("USDT", "USDC", "10");
      try {
        ids.push((await bitnob.submitOrder({ base_currency: "USDT", quote_currency: "USDC", side: "sell", quantity: "10", price: q.price, quote_id: q.id, reference: r })).data.order.id);
      } catch (e) { return { first: ids[0], second_error: errOf(e) }; }
    }
    return { first: ids[0], second: ids[1], same: ids[0] === ids[1] };
  });

  if (crypto_()) await runCase("Market order, crypto (no quote_id)", "fills at market", async () => {
    const o = (await bitnob.submitOrder({ base_currency: "USDT", quote_currency: "USDC", side: "sell", quantity: "10", reference: ref() })).data.order;
    return { status: o.status, price: o.price };
  });

  if (ngn_()) await runCase("Market order, NGN, no reference", "rejected: reference required", async () => {
    const o = (await bitnob.submitOrder({ base_currency: "NGN", quote_currency: "USDT", side: "sell", quantity: "500" })).data.order;
    return { status: o.status };
  });

  if (ngn_()) await runCase("Market order, NGN, with reference", "fills at market", async () => {
    const o = (await bitnob.submitOrder({ base_currency: "NGN", quote_currency: "USDT", side: "sell", quantity: "500", reference: ref() })).data.order;
    return { status: o.status, id: o.id };
  });

  if (crypto_()) await runCase("Bad signature (wrong secret)", "401", async () => {
    const real = process.env.BITNOB_CLIENT_SECRET;
    process.env.BITNOB_CLIENT_SECRET = "not-the-secret";
    try { return await bitnob.whoami(); } finally { process.env.BITNOB_CLIENT_SECRET = real; }
  });
}

(async () => {
  const who = (await bitnob.whoami()).data;
  if (who.environment !== "sandbox" && !process.env.ALLOW_PROD) {
    throw new Error(`Refusing to run against "${who.environment}". Set ALLOW_PROD=1 to override.`);
  }
  results.environment = who.environment;
  if (crypto_()) await topUp();
  await directions();
  await cases();
  results.finished_at = new Date().toISOString();
  const file = path.join(__dirname, "results", `sandbox-${ONLY || "all"}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  const pass = results.directions.filter((d) => d.ok).length;
  console.log(`\n${pass}/${results.directions.length} directions filled. Results: ${file}`);
  if (pass !== results.directions.length) process.exitCode = 1;
})().catch((e) => { console.error(e.message, e.body ?? ""); process.exit(1); });

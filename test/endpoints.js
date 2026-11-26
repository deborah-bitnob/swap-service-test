// Checks every swap-related endpoint against what its API reference says.
// Run: npm run test:endpoints   (sandbox only; places a few small orders)
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const bitnob = require("../lib/bitnob");

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = () => `ep-${crypto.randomUUID()}`;

// Thin wrapper: returns { status, body } instead of throwing.
async function call(method, p, body) {
  try { return { status: 200, body: await bitnob.request(method, p, body) }; }
  catch (e) { if (!e.status) throw e; return { status: e.status, body: e.body, code: e.code, detail: e.detail }; }
}

// GET with a JSON body (fetch can't send one); signed the same way.
function getWithBody(p, body) {
  const payload = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const { BITNOB_BASE_URL: base, BITNOB_CLIENT_ID: id, BITNOB_CLIENT_SECRET: secret } = process.env;
  const headers = {
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload),
    "X-Auth-Client": id, "X-Auth-Timestamp": ts, "X-Auth-Nonce": nonce,
    "X-Auth-Signature": bitnob.sign({ clientId: id, clientSecret: secret, payload, timestamp: ts, nonce }),
  };
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(p, base), { method: "GET", headers }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => { let j = {}; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, body: j }); });
    });
    req.on("error", reject); req.end(payload);
  });
}

function check(endpoint, name, expected, actual, pass, extra) {
  results.push({ endpoint, name, expected, actual, pass: !!pass, ...(extra ? { extra } : {}) });
  console.log(`${pass ? "PASS" : "FAIL"} [${endpoint}] ${name}\n     expected: ${expected}\n     actual:   ${actual}`);
}
const brief = (r) => `${r.status}${r.code ? " " + r.code : ""}${r.detail ? ` "${r.detail}"` : ""}`;
const dec = (s) => (String(s).split(".")[1] || "").length;

async function quote(base, q, qty) {
  return (await bitnob.createQuote({ base_currency: base, quote_currency: q, side: "sell", quantity: qty })).data.quote;
}
async function order(body) { return call("POST", "/api/trading/orders", body); }

(async () => {
  const who = (await bitnob.whoami()).data;
  if (who.environment !== "sandbox") throw new Error(`Refusing to run against ${who.environment}`);
  const E = (s) => s;

  // ---------- GET /api/trading/prices ----------
  let ep = "GET /api/trading/prices";
  let r = await call("GET", "/api/trading/prices");
  const all = r.body?.data;
  check(ep, "No params returns all prices", "200, a list of prices", `${r.status}, ${JSON.stringify(all).slice(0, 160)}`, r.status === 200, all);
  r = await call("GET", "/api/trading/prices?base_currency=BTC&quote_currency=USDT");
  check(ep, "Both params returns one pair", "200, mid price for BTC/USDT", `${r.status}, ${JSON.stringify(r.body?.data).slice(0, 200)}`, r.status === 200 && r.body?.data);
  r = await call("GET", "/api/trading/prices?base_currency=%20btc%20&quote_currency=usdt");
  check(ep, "Codes are trimmed and upper-cased", "200", brief(r), r.status === 200);
  r = await call("GET", "/api/trading/prices?base_currency=BTC");
  check(ep, "Only one param", "400", brief(r), r.status === 400);
  r = await call("GET", "/api/trading/prices?base_currency=USDT&quote_currency=KES");
  check(ep, "Unknown pair", "400 VALIDATION_ERROR", brief(r), r.status === 400);
  r = await call("GET", "/api/trading/prices?base_currency=NGN&quote_currency=USDT");
  check(ep, "NGN pair (docs: not returned here)", "an error, NGN pairs not listed", brief(r) + " " + JSON.stringify(r.body?.data ?? "").slice(0, 120), r.status !== 200);

  // ---------- POST /api/trading/quotes + GET /api/trading/quotes/{id} ----------
  ep = "GET /api/trading/quotes/{id}";
  const q1 = await quote("USDC", "USDT", "10");
  r = await call("GET", `/api/trading/quotes/${q1.id}`);
  const st = r.body?.data?.quote ?? r.body?.data;
  check(ep, "Fresh crypto quote", "200, nothing consumed, not expired or exhausted", `${r.status}, ${JSON.stringify(st).slice(0, 300)}`, r.status === 200, st);
  const o1 = await order({ base_currency: "USDC", quote_currency: "USDT", side: "sell", quantity: "10", price: q1.price, quote_id: q1.id, reference: ref() });
  r = await call("GET", `/api/trading/quotes/${q1.id}`);
  const st2 = r.body?.data?.quote ?? r.body?.data;
  check(ep, "After a full order", "200, consumed 10, exhausted", `${r.status}, ${JSON.stringify(st2).slice(0, 300)}`, r.status === 200 && JSON.stringify(st2).includes("true"), st2);
  if (st2 && "consumption_count" in st2) check(ep, "consumption_count is a string", "string", typeof st2.consumption_count, typeof st2.consumption_count === "string");
  r = await call("GET", "/api/trading/quotes/not-a-uuid");
  check(ep, "Non-UUID id", "400", brief(r), r.status === 400);
  r = await call("GET", `/api/trading/quotes/${crypto.randomUUID()}`);
  check(ep, "Unknown UUID", "404", brief(r), r.status === 404);
  const qn = await quote("NGN", "USDT", "500");
  r = await call("GET", `/api/trading/quotes/${qn.id}`);
  check(ep, "NGN quote", "404 (NGN quotes aren't tracked)", brief(r), r.status === 404);

  // ---------- POST /api/trading/orders + GET /api/trading/orders/{id} ----------
  ep = "POST /api/trading/orders";
  check(ep, "Quote-backed crypto order", "200, status filled", `${o1.status}, ${o1.body?.data?.order?.status}`, o1.body?.data?.order?.status === "filled");
  const cryptoOrderId = o1.body?.data?.order?.id;
  r = await order({ base_currency: "NGN", quote_currency: "USDT", side: "sell", quantity: "500", price: qn.price, quote_id: qn.id, reference: ref() });
  const ngnOrderId = r.body?.data?.order?.id;
  check(ep, "Quote-backed NGN order", "200, status filled", `${r.status}, ${r.body?.data?.order?.status}`, r.body?.data?.order?.status === "filled");
  r = await order({ base_currency: "USDC", quote_currency: "USDT", side: "sell", quantity: "10", reference: ref() });
  check(ep, "Crypto, no quote_id (docs: market rate)", "fills at market", brief(r), r.status === 200);
  r = await order({ base_currency: "USDC", quote_currency: "USDT", side: "SELL", quantity: "10", price: "1", reference: ref() });
  check(ep, "Upper-case side", "accepted", brief(r) + " " + (r.body?.data?.order?.status ?? ""), r.status === 200);

  ep = "GET /api/trading/orders/{id}";
  r = await call("GET", `/api/trading/orders/${cryptoOrderId}`);
  check(ep, "Crypto order by id", "200", brief(r) + " " + r.body?.data?.order?.status, r.status === 200);
  r = await call("GET", `/api/trading/orders/${ngnOrderId}`);
  check(ep, "NGN order by id", "200", brief(r) + " " + r.body?.data?.order?.status, r.status === 200);
  r = await call("GET", `/api/trading/orders/${crypto.randomUUID()}`);
  check(ep, "Unknown UUID", "404", brief(r), r.status === 404);

  // ---------- DELETE /api/trading/orders/{id} ----------
  ep = "DELETE /api/trading/orders/{id}";
  r = await call("DELETE", `/api/trading/orders/${cryptoOrderId}`);
  check(ep, "Cancel a filled order", "422 PRECONDITION_FAILED", brief(r), r.status === 422);
  r = await call("DELETE", `/api/trading/orders/${ngnOrderId}`);
  check(ep, "Cancel an NGN order", "404", brief(r), r.status === 404);
  r = await call("DELETE", `/api/trading/orders/${crypto.randomUUID()}`);
  check(ep, "Cancel an unknown UUID", "404", brief(r), r.status === 404);
  // An in-band limit price far from market (USDC/USDT band is 0.80-1.20).
  r = await order({ base_currency: "USDC", quote_currency: "USDT", side: "sell", quantity: "10", price: "5", reference: ref() });
  check(ep, "Limit price outside the band", "400, names the band", brief(r), r.status === 400);
  r = await order({ base_currency: "USDC", quote_currency: "USDT", side: "sell", quantity: "10", price: "1.19", reference: ref() });
  const off = r.body?.data?.order;
  check(ep, "Limit 19% above market (could rest as open)", "an open order to cancel", `${brief(r)} ${off?.status ?? ""}`, off && off.status !== "filled", off);
  if (off && off.status !== "filled") {
    r = await call("DELETE", `/api/trading/orders/${off.id}`);
    check(ep, "Cancel an open order", "200, status cancelled", `${brief(r)} ${r.body?.data?.order?.status ?? ""}`, r.status === 200);
  }

  // Same crypto body twice: the second is refused, but is an order left behind?
  ep = "POST /api/trading/orders";
  {
    const q = await quote("USDC", "USDT", "10");
    const body = { base_currency: "USDC", quote_currency: "USDT", side: "sell", quantity: "10", price: q.price, quote_id: q.id, reference: ref() };
    const a = await order(body);
    const b2 = await order(body);
    check(ep, "Same crypto body sent twice", "second refused, no second order", `first ${a.body?.data?.order?.status}, second ${brief(b2)}`, b2.status === 422);
    await sleep(3000);
    const byRef = await call("GET", `/api/trading/orders/${body.reference}`);
    const got = byRef.body?.data?.order;
    check("GET /api/trading/orders/{id}", "Lookup by reference after a refused resend", "the filled order", `${got?.status} ${got?.id === a.body?.data?.order?.id ? "(the filled one)" : "(a different order)"}`, got?.id === a.body?.data?.order?.id, got);
    if (got && got.id !== a.body?.data?.order?.id && got.status === "pending") {
      const c = await call("DELETE", `/api/trading/orders/${got.id}`); // clean up the stray order
      check("DELETE /api/trading/orders/{id}", "Cancel the stray pending order", "200 cancelled", `${brief(c)} ${c.body?.data?.order?.status ?? ""}`, c.status === 200);
      const c2 = await call("DELETE", `/api/trading/orders/${got.id}`);
      check("DELETE /api/trading/orders/{id}", "Cancel it again", "422 PRECONDITION_FAILED", brief(c2), c2.status === 422);
    }
  }

  // ---------- GET /api/trading/orders ----------
  ep = "GET /api/trading/orders";
  r = await call("GET", "/api/trading/orders");
  const list = r.body?.data;
  const items = list?.orders ?? list?.items ?? [];
  check(ep, "No filter", "200, crypto orders only, total_count a string", `${r.status}, ${items.length} orders, total_count ${JSON.stringify(list?.total_count)} (${typeof list?.total_count}), keys ${Object.keys(list || {})}`, r.status === 200 && typeof list?.total_count === "string");
  check(ep, "NGN orders excluded", "NGN order not listed", items.some((o) => o.id === ngnOrderId) ? "listed" : "not listed", !items.some((o) => o.id === ngnOrderId));
  check(ep, "Includes the crypto order just placed", "listed", items.some((o) => o.id === cryptoOrderId) ? "listed" : `not in first ${items.length}`, items.some((o) => o.id === cryptoOrderId));
  const pairs = (os) => [...new Set(os.map((o) => `${o.base_currency}/${o.quote_currency}`))].join(", ");
  r = await getWithBody("/api/trading/orders", { base_currency: "BTC", status: "filled", limit: 50 });
  let fl = r.body?.data?.orders ?? [];
  check(ep, "JSON body filter base_currency=BTC", "only BTC-base orders", `${r.status}, ${fl.length}: ${pairs(fl)}`, r.status === 200 && fl.every((o) => o.base_currency === "BTC"));
  check(ep, "JSON body filter status=filled", "only filled", [...new Set(fl.map((o) => o.status))].join(", "), fl.every((o) => o.status === "filled"));
  r = await getWithBody("/api/trading/orders", { status: "filled", limit: 2 });
  check(ep, "JSON body filter limit=2", "2 orders", `${r.status}, ${(r.body?.data?.orders ?? []).length}`, (r.body?.data?.orders ?? []).length === 2);
  r = await getWithBody("/api/trading/orders", { limit: 2 });
  check(ep, "JSON body with only limit", "200", `${r.status}${r.body?.data ? "" : " (non-JSON response)"}`, r.status === 200);
  r = await call("GET", "/api/trading/orders?limit=2&base_currency=BTC");
  const fq = r.body?.data?.orders ?? [];
  check(ep, "Filters in the query string (docs: ignored)", "ignored", `${r.status}, ${fq.length} orders, ${[...new Set(fq.map((o) => o.base_currency))]}`, true);

  // ---------- GET /api/exchange-rates ----------
  ep = "GET /api/exchange-rates";
  r = await call("GET", "/api/exchange-rates?from=USDT&to=NGN");
  const rate = r.body?.data;
  check(ep, "Pair rate", "200 with sell/buy/mid/inverse, valid_for_seconds 300", `${r.status}, ${JSON.stringify(rate).slice(0, 300)}`, r.status === 200, rate);
  if (rate?.sell_rate) {
    const inv = 1 / Number(rate.sell_rate);
    check(ep, "inverse_rate = 1/sell_rate", inv.toFixed(8), rate.inverse_rate, Math.abs(Number(rate.inverse_rate) - inv) < 1e-8);
    check(ep, "mid_rate = average of sell and buy", ((Number(rate.sell_rate) + Number(rate.buy_rate)) / 2).toFixed(8), rate.mid_rate, Math.abs(Number(rate.mid_rate) - (Number(rate.sell_rate) + Number(rate.buy_rate)) / 2) < 1e-6);
    check(ep, "Rates fixed to 8 decimals", "8", `${dec(rate.sell_rate)}, ${dec(rate.buy_rate)}, ${dec(rate.mid_rate)}`, [rate.sell_rate, rate.buy_rate, rate.mid_rate].every((x) => dec(x) === 8));
    check(ep, "valid_for_seconds", "300", String(rate.valid_for_seconds), rate.valid_for_seconds === 300);
  }
  r = await call("GET", "/api/exchange-rates?from=usdt&to=ngn");
  check(ep, "Case-insensitive codes", "200", brief(r), r.status === 200);
  r = await call("GET", "/api/exchange-rates?from=USDT");
  check(ep, "Only one of from/to", "400 INVALID_PARAMS", brief(r), r.status === 400 && r.code === "INVALID_PARAMS");
  r = await call("GET", "/api/exchange-rates?from=USDT&to=XYZ");
  check(ep, "Unsupported currency", "400 VALIDATION_ERROR", brief(r), r.status === 400);
  r = await call("GET", "/api/exchange-rates");
  const ar = r.body?.data;
  check(ep, "All rates, default base", "200, base USD", `${r.status}, base ${ar?.base_currency}, ${(ar?.rates || []).length} rates, skipped ${JSON.stringify(ar?.skipped_currencies)}`, r.status === 200, ar);
  r = await call("GET", "/api/exchange-rates?base=ngn");
  check(ep, "All rates, base echoed as sent", "base_currency \"ngn\"", `${r.status}, base_currency ${JSON.stringify(r.body?.data?.base_currency)}`, r.body?.data?.base_currency === "ngn");
  for (const [f, t] of [["USDT", "KES"], ["USDT", "UGX"], ["USDT", "GHS"], ["BTC", "NGN"]]) {
    r = await call("GET", `/api/exchange-rates?from=${f}&to=${t}`);
    check(ep, `Rate ${f}/${t}`, "info", `${brief(r)} sell ${r.body?.data?.sell_rate ?? "-"}`, true);
  }

  // ---------- GET /api/exchange-rates/convert ----------
  ep = "GET /api/exchange-rates/convert";
  r = await call("GET", "/api/exchange-rates/convert?from=USDT&to=NGN&amount=100.50");
  const cv = r.body?.data;
  check(ep, "Convert 100.50 USDT to NGN", "200, to_amount = amount × rate_used", `${r.status}, ${JSON.stringify(cv).slice(0, 250)}`, r.status === 200, cv);
  if (cv?.rate_used) {
    const exp = 100.5 * Number(cv.rate_used);
    check(ep, "to_amount = amount × rate_used", exp.toString(), String(cv.to_amount), Math.abs(Number(cv.to_amount) - exp) < 1e-6);
    check(ep, "rate_used fixed to 8 decimals", "8", String(dec(cv.rate_used)), dec(cv.rate_used) === 8);
    if (rate?.sell_rate) check(ep, "Uses the sell rate", rate.sell_rate, cv.rate_used, Math.abs(Number(cv.rate_used) - Number(rate.sell_rate)) / Number(rate.sell_rate) < 0.01);
  }
  r = await call("GET", "/api/exchange-rates/convert?from=USDT&to=NGN&amount=0");
  check(ep, "Amount 0", "400 INVALID_PARAMS", brief(r), r.status === 400);
  r = await call("GET", "/api/exchange-rates/convert?from=USDT&to=NGN&amount=-5");
  check(ep, "Negative amount", "400 INVALID_PARAMS", brief(r), r.status === 400);
  r = await call("GET", "/api/exchange-rates/convert?from=USDT&to=NGN");
  check(ep, "Missing amount", "400 INVALID_PARAMS", brief(r), r.status === 400);
  r = await call("GET", "/api/exchange-rates/convert?from=USDT&to=XYZ&amount=1");
  check(ep, "Unsupported currency", "400 VALIDATION_ERROR", brief(r), r.status === 400);

  // ---------- POST /api/exchange-rates/conversions ----------
  ep = "POST /api/exchange-rates/conversions";
  const conv = (b) => call("POST", "/api/exchange-rates/conversions", b);
  r = await conv({ from_currency: "NGN", to_currency: "USDT", from_amount: "1000", idempotency_key: ref() });
  check(ep, "Valid NGN → USDT body", "400 VALIDATION_ERROR (invalid quote_id), never 201", brief(r), r.status === 400);
  r = await conv({ from_currency: "USDT", to_currency: "BTC", from_amount: "10", idempotency_key: ref() });
  check(ep, "Neither side NGN", "400", brief(r), r.status === 400);
  r = await conv({ from_currency: "NGN", to_currency: "NGN", from_amount: "1000", idempotency_key: ref() });
  check(ep, "Same currency", "400", brief(r), r.status === 400);
  r = await conv({ from_currency: "NGN", to_currency: "USDT", from_amount: "1000000001", idempotency_key: ref() });
  check(ep, "from_amount above 1,000,000,000", "400", brief(r), r.status === 400);
  r = await conv({ from_currency: "NGN", to_currency: "USDT", from_amount: "0", idempotency_key: ref() });
  check(ep, "from_amount 0", "400", brief(r), r.status === 400);
  r = await conv({ from_currency: "NGN", to_currency: "KES", from_amount: "1000", idempotency_key: ref() });
  check(ep, "Currency not on allow-list", "400", brief(r), r.status === 400);

  // ---------- GET /api/exchange-rates/conversions ----------
  ep = "GET /api/exchange-rates/conversions";
  r = await call("GET", "/api/exchange-rates/conversions?page=1&page_size=5");
  const cl = r.body?.data;
  const citems = cl?.items ?? [];
  check(ep, "First page", "200, newest first, includes NGN trade orders", `${r.status}, ${citems.length} items, total ${cl?.total}, keys ${Object.keys(cl || {})}`, r.status === 200, citems[0]);
  check(ep, "Includes the NGN order just placed", "listed", citems.some((c) => c.id === ngnOrderId) ? "listed" : "not listed", citems.some((c) => c.id === ngnOrderId));
  const times = citems.map((c) => c.created_at);
  check(ep, "Newest first", "descending created_at", times.join(" > "), times.every((t, i) => i === 0 || t <= times[i - 1]));
  r = await call("GET", "/api/exchange-rates/conversions?page=100000&page_size=5");
  check(ep, "Empty page", "200, data is {}", `${r.status}, ${JSON.stringify(r.body?.data)}`, r.status === 200 && JSON.stringify(r.body?.data) === "{}");

  // ---------- GET /api/exchange-rates/conversions/{id} ----------
  ep = "GET /api/exchange-rates/conversions/{id}";
  r = await call("GET", `/api/exchange-rates/conversions/${ngnOrderId}`);
  check(ep, "NGN order id is its conversion id", "200", `${brief(r)} ${JSON.stringify(r.body?.data).slice(0, 250)}`, r.status === 200, r.body?.data);
  r = await call("GET", `/api/exchange-rates/conversions/${cryptoOrderId}`);
  check(ep, "Crypto order id", "404", brief(r), r.status === 404);
  r = await call("GET", "/api/exchange-rates/conversions/not-a-uuid");
  check(ep, "Non-UUID id", "400 VALIDATION_ERROR", brief(r), r.status === 400);
  r = await call("GET", `/api/exchange-rates/conversions/${crypto.randomUUID()}`);
  check(ep, "Unknown UUID", "404 NOT_FOUND", brief(r), r.status === 404);

  fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
  const file = path.join(__dirname, "results", `endpoints-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const fails = results.filter((x) => !x.pass);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed. Results: ${file}`);
  if (fails.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });

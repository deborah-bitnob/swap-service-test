// Offline tests: no network, no credentials.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sign } = require("../lib/bitnob");
const { buildTrade, allDirections, isSupported } = require("../lib/pairs");
const { toMajor } = require("../lib/units");

test("sign matches HMAC-SHA256 of CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD", () => {
  const args = { clientId: "cid", clientSecret: "sec", timestamp: "1719236465", nonce: "ab", payload: '{"a":1}' };
  const expected = crypto.createHmac("sha256", "sec").update('cid:1719236465:ab:{"a":1}').digest("hex");
  assert.equal(sign(args), expected);
});

test("GET requests sign an empty payload", () => {
  const s = sign({ clientId: "c", clientSecret: "s", timestamp: "1", nonce: "n", payload: "" });
  assert.equal(s, crypto.createHmac("sha256", "s").update("c:1:n:").digest("hex"));
});

test("every direction builds base=from, quote=to, side=sell", () => {
  const dirs = allDirections();
  assert.equal(dirs.length, 12);
  for (const [from, to] of dirs) {
    const ngnPair = from === "NGN" || to === "NGN";
    const amount = from === "NGN" ? "500" : ngnPair ? "1" : from === "BTC" ? "0.0001" : "10";
    const { trade, ngn } = buildTrade(from, to, amount);
    assert.deepEqual(trade, { base_currency: from, quote_currency: to, side: "sell", quantity: amount });
    assert.equal(ngn, from === "NGN" || to === "NGN");
  }
});

test("input is normalized and validated", () => {
  assert.equal(buildTrade("btc", "usdt", "0.0001").trade.base_currency, "BTC");
  assert.throws(() => buildTrade("BTC", "BTC", "1"), /must differ/);
  assert.throws(() => buildTrade("USDT", "GHS", "1"), /Unsupported pair/);
  assert.throws(() => buildTrade("USDT", "BTC", "-1"), /Bad amount/);
  assert.throws(() => buildTrade("USDT", "BTC", "1e3"), /Bad amount/);
  assert.throws(() => buildTrade("USDT", "BTC", "0"), /Bad amount/);
  assert.throws(() => buildTrade("NGN", "USDT", "499"), /₦500/);
  assert.throws(() => buildTrade("USDT", "USDC", "5"), /starts at 10 USDT/);
  assert.throws(() => buildTrade("BTC", "USDT", "0.00003"), /starts at 0.0001 BTC/);
  assert.doesNotThrow(() => buildTrade("BTC", "NGN", "0.00003"));
  assert.ok(isSupported("USDT", "NGN"));
});

test("BitnobError reads both error shapes", () => {
  const { BitnobError } = require("../lib/bitnob");
  const a = new BitnobError("POST", "/x", 400, { code: "VALIDATION_ERROR", detail: "minimum 10 USDT" });
  assert.equal(a.code, "VALIDATION_ERROR"); assert.equal(a.detail, "minimum 10 USDT");
  const b = new BitnobError("POST", "/x", 400, { success: false, error: { code: "BAD_REQUEST", message: "reference is required" } });
  assert.equal(b.code, "BAD_REQUEST"); assert.equal(b.detail, "reference is required");
});

test("toMajor converts minor-unit balances", () => {
  assert.equal(toMajor("BTC", "37955"), "0.00037955");
  assert.equal(toMajor("USDT", "47689560"), "47.689560");
  assert.equal(toMajor("NGN", "20957487"), "209574.87");
  assert.equal(toMajor("NGN", "5"), "0.05");
});

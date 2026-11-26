// Supported pairs and the request body for a swap.
const CURRENCIES = ["BTC", "USDT", "USDC", "NGN"];

const SUPPORTED = new Set([
  "BTC/USDT", "BTC/USDC", "USDC/USDT",
  "NGN/USDT", "NGN/USDC", "NGN/BTC",
]);

const NGN_MIN = 500;
// Smallest quote on crypto-only pairs (sandbox, 2026-11-26). NGN pairs allow less on the crypto side.
const CRYPTO_MIN = { BTC: 0.0001, USDT: 10, USDC: 10 };

function isSupported(a, b) {
  return SUPPORTED.has(`${a}/${b}`) || SUPPORTED.has(`${b}/${a}`);
}

const isNgnPair = (from, to) => from === "NGN" || to === "NGN";

// Every direction: base = what you spend, quote = what you receive, side = sell,
// quantity in major units of the currency you spend.
function buildTrade(from, to, amount) {
  from = String(from).toUpperCase();
  to = String(to).toUpperCase();
  amount = String(amount);
  if (from === to) throw new Error("from and to must differ");
  if (!isSupported(from, to)) throw new Error(`Unsupported pair: ${from} -> ${to}`);
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new Error(`Bad amount: ${amount}`);
  if (from === "NGN" && Number(amount) < NGN_MIN) throw new Error(`NGN trades start at ₦${NGN_MIN}`);
  if (!isNgnPair(from, to) && Number(amount) < CRYPTO_MIN[from]) {
    throw new Error(`${from} -> ${to} starts at ${CRYPTO_MIN[from]} ${from}`);
  }

  return {
    trade: { base_currency: from, quote_currency: to, side: "sell", quantity: amount },
    ngn: isNgnPair(from, to),
  };
}

// Every supported direction, both ways.
function allDirections() {
  const out = [];
  for (const pair of SUPPORTED) {
    const [a, b] = pair.split("/");
    out.push([a, b], [b, a]);
  }
  return out;
}

module.exports = { CURRENCIES, NGN_MIN, CRYPTO_MIN, buildTrade, isSupported, allDirections };

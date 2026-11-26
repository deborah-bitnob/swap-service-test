// Balances come back as integer strings in minor units; trades take major units.
const DECIMALS = { BTC: 8, USDT: 6, USDC: 6, NGN: 2 };

function toMajor(currency, minor) {
  const d = DECIMALS[currency];
  if (d === undefined) throw new Error(`Unknown currency: ${currency}`);
  const s = String(minor).padStart(d + 1, "0");
  return `${s.slice(0, -d)}.${s.slice(-d)}`;
}

module.exports = { DECIMALS, toMajor };

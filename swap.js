// CLI: node --env-file=.env swap.js <from> <to> <amount>
const bitnob = require("./lib/bitnob");
const ledger = require("./lib/db");
const { swap } = require("./lib/swap");
const { toMajor } = require("./lib/units");

const [from, to, amount] = process.argv.slice(2);
if (!from || !to || !amount) {
  console.error("Usage: node --env-file=.env swap.js <from> <to> <amount>   e.g. swap.js NGN USDT 500");
  process.exit(1);
}

(async () => {
  const { order } = await swap(from, to, amount, { ledger });
  for (const c of [order.base_currency, order.quote_currency]) {
    const { data } = await bitnob.getBalance(c);
    console.log(`${c.padEnd(4)} available ${toMajor(c, data.available_balance)}`);
  }
})().catch((e) => {
  console.error(e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});

// Check auth and show every balance in major units.
const bitnob = require("./lib/bitnob");
const { CURRENCIES } = require("./lib/pairs");
const { toMajor } = require("./lib/units");

(async () => {
  const { data } = await bitnob.whoami();
  console.log(`Authenticated (${data.environment || "unknown env"})`);
  for (const c of CURRENCIES) {
    const { data: b } = await bitnob.getBalance(c);
    console.log(`${c.padEnd(4)} available ${toMajor(c, b.available_balance)}`);
  }
})().catch((e) => {
  console.error(e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});

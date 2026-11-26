// Webhook receiver: verifies x-bitnob-signature and updates the ledger on trade events.
const crypto = require("crypto");
const express = require("express");
const ledger = require("./lib/db");

const app = express();
const seen = new Set(); // event_ids already handled; use a table in production

function verify(raw, signature) {
  const expected = crypto.createHmac("sha512", process.env.BITNOB_WEBHOOK_SECRET).update(raw).digest("hex");
  return signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

app.post("/webhooks/bitnob", express.raw({ type: "*/*" }), (req, res) => {
  if (!verify(req.body, req.get("x-bitnob-signature") || "")) return res.sendStatus(401);
  res.sendStatus(200); // ack fast, then process

  const event = JSON.parse(req.body.toString("utf8"));
  if (seen.has(event.event_id)) return;
  seen.add(event.event_id);

  const { reference, reason } = event.data || {};
  if (event.event === "trade.completed") {
    ledger.update({ reference, status: "filled" });
    console.log(`completed ${reference}`);
  } else if (event.event === "trade.failed") {
    ledger.update({ reference, status: "failed" });
    console.log(`failed ${reference}: ${reason}`);
  } else {
    console.log(`ignored ${event.event}`);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Webhook listener on :${port}`));

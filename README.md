# swap-service

Test Bitnob swaps between BTC, USDT, USDC and NGN: quote, order, then confirm by polling the order.

## Setup

Node 20.6 or later.

```bash
npm install
cp .env.example .env   # fill in sandbox credentials
npm run check          # auth + balances
```

Your public IP must be on the key's allowlist; a `403` "IP address not whitelisted" means it isn't.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Confirms auth and prints every balance in major units |
| `npm run swap -- NGN USDT 500` | One swap: quote, order, confirm, balances |
| `npm run reconcile` | Resolves swaps still `pending` in `swaps.db` |
| `npm run server` | Webhook receiver on `/webhooks/bitnob` |
| `npm test` | Offline unit tests (signing, pairs, units, errors) |
| `npm run test:endpoints` | Checks all 12 swap endpoints against the API reference (sandbox; places a few small orders) |
| `npm run test:sandbox` | Live suite: all 12 directions + failure cases. `ONLY=crypto` or `ONLY=ngn` runs one half |

The sandbox suite refuses to run unless `/api/whoami` reports `sandbox` (override with `ALLOW_PROD=1`). Results go to `test/results/`.

## Layout

```
lib/bitnob.js   signed API client
lib/pairs.js    supported pairs, request body, minimums
lib/swap.js     one swap: quote -> order -> confirm
lib/confirm.js  poll an order to a final status
lib/db.js       SQLite ledger (swaps.db)
lib/units.js    minor -> major units for balances
```

## Rules the code follows

- Every direction: `base_currency` = what you spend, `quote_currency` = what you receive, `side: "sell"`, `quantity` in the spent currency.
- Crypto-only pairs start at 0.0001 BTC, 10 USDT or 10 USDC. NGN pairs start at ₦500 on the NGN side.
- Crypto orders: look up by reference; never resend blindly. NGN orders: look up by id; resending the same reference returns the original order.
- Balances are integer strings in minor units (sats, 6-decimal USDT/USDC, kobo).

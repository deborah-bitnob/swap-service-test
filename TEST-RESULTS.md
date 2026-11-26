# Testing swaps across every currency

Nov 26, 2026

Sandbox test results for swaps between BTC, USDT, USDC and NGN, run on 26 Nov 2026 with the swap-service example.

## Results: every direction

All 12 directions filled in sandbox on 26 Nov 2026 (10:49–10:51 UTC), each with a locked quote and `side: "sell"`.

| Spend | Receive | Amount sent | Received | Quote TTL | Lookup by reference | Lookup by id |
| --- | --- | --- | --- | --- | --- | --- |
| BTC | USDT | 0.0001 BTC | 6.045026 USDT | 297 s | filled | filled |
| USDT | BTC | 10 USDT | 0.00016499 BTC | 297 s | filled | filled |
| BTC | USDC | 0.0001 BTC | 6.037875 USDC | 297 s | filled | filled |
| USDC | BTC | 10 USDC | 0.00016518 BTC | 297 s | filled | filled |
| USDC | USDT | 10 USDC | 10.006394 USDT | 297 s | filled | filled |
| USDT | USDC | 10 USDT | 9.983621 USDC | 297 s | filled | filled |
| NGN | USDT | ₦500 | 0.34458 USDT | 30 s | 400 | filled |
| USDT | NGN | 2 USDT | ₦2,868.49 | 30 s | 400 | filled |
| NGN | USDC | ₦500 | 0.34424 USDC | 30 s | 400 | filled |
| USDC | NGN | 2 USDC | ₦2,865.62 | 30 s | 400 | filled |
| NGN | BTC | ₦500 | 0.0000057 BTC | 30 s | 400 | filled |
| BTC | NGN | 0.00003 BTC | ₦2,602.92 | 30 s | 400 | filled |

Every order came back `filled` in the order response itself, within 0.6–2.3 s of the quote. Raw results are in `test/results/sandbox-*.json`.

## Rules per currency

Crypto-only pairs and NGN pairs behave like two different systems: different minimums, quote windows, lookups, retries and error shapes.

| Rule | Crypto-only pairs (BTC, USDT, USDC) | NGN pairs |
| --- | --- | --- |
| Minimum | 0.0001 BTC, 10 USDT, 10 USDC on the spent side | ₦500 on the NGN side, either direction; the crypto side can be smaller (0.00003 BTC and 2 USDT filled) |
| Too small | `400 VALIDATION_ERROR` "Quote quantity too small: minimum 10 USDT" | `400 INVALID_AMOUNT` "amount below configured minimum" |
| Quote window (sandbox) | 297 s | 30 s |
| Look up an order | By reference or by id | By id only; by reference returns `400` |
| Same body sent twice | Second fails: `422` "Quote has been fully consumed" | Second returns the original order (same id) |
| Same reference, fresh quote | Creates a second order | Not tested |
| No `quote_id` | Needs `price`, else `400` "price is required when quote_id is not provided" | Needs `reference`, else `400` "reference is required when quote_id is omitted"; with one, it filled |
| Error body | `{ code, detail }` | `{ success: false, error: { code, message } }` |

Balances come back as integer strings in minor units: sats for BTC, 6 decimals for USDT and USDC, kobo for NGN. Trade quantities are in major units.

## Failure cases

Every failure case was rejected cleanly and moved no funds, except the repeated crypto reference with a fresh quote, which made a second trade.

| Case | Response |
| --- | --- |
| ₦499 NGN → USDT quote | `400 INVALID_AMOUNT` "amount below configured minimum" |
| 5 USDT → USDC quote | `400 VALIDATION_ERROR` "Quote quantity too small: minimum 10 USDT" |
| 0.3 USDT → NGN quote (about ₦430) | `400 INVALID_AMOUNT` |
| 100,000 USDC → USDT order | Quote succeeded; order `422 PRECONDITION_FAILED` "Insufficient funds to complete this order." |
| ₦9,000,000 NGN → USDT quote | `422 INSUFFICIENT_FUNDS` "insufficient balance", at the quote step |
| NGN order after its quote expired | `422 PRECONDITION_FAILED` "quote has expired" |
| Same NGN order body sent twice | Same order id both times |
| Same crypto order body sent twice | First filled; second `422 PRECONDITION_FAILED` "Quote has been fully consumed" |
| Same crypto reference, new quote | Two different orders, both filled |
| Crypto order, no `quote_id` or `price` | `400 VALIDATION_ERROR` "price is required when quote_id is not provided" |
| Crypto order, `price` but no `quote_id` | Filled as a `limit` order |
| NGN order, no `quote_id` or `reference` | `400 BAD_REQUEST` "reference is required when quote_id is omitted" |
| NGN order, `reference` but no `quote_id` | Filled |
| Wrong client secret | `401 UNAUTHORIZED` "Invalid HMAC signature" |

Note that a crypto insufficient-balance check happens at the order, while the NGN one happens at the quote.

## Endpoint checks against the API reference

65 of 72 checks passed across the 12 swap endpoints (sandbox, 26 Nov 2026, `npm run test:endpoints`). The rate, quote-status and conversion endpoints behave exactly as documented. Every mismatch is in ordering, cancelling or listing crypto orders.

| Endpoint | Checks passed | Mismatch |
| --- | --- | --- |
| `GET /api/trading/prices` | 6 / 6 | |
| `POST /api/trading/quotes` | covered by the swap suite | |
| `GET /api/trading/quotes/{id}` | 6 / 6 | |
| `POST /api/trading/orders` | 4 / 5 | Crypto order without `quote_id` needs `price` |
| `GET /api/trading/orders/{id}` | 3 / 4 | Lookup by reference can return a stray order |
| `DELETE /api/trading/orders/{id}` | 4 / 7 | 404 instead of 422; limit orders never rest |
| `GET /api/trading/orders` | 6 / 8 | `base_currency` filter matches both sides; `limit`-only body gets 403 |
| `GET /api/exchange-rates` | 14 / 14 | |
| `GET /api/exchange-rates/convert` | 8 / 8 | |
| `POST /api/exchange-rates/conversions` | 6 / 6 | |
| `GET /api/exchange-rates/conversions` | 4 / 4 | |
| `GET /api/exchange-rates/conversions/{id}` | 4 / 4 | |

### Mismatches

| What was sent | Reference says | Sandbox did |
| --- | --- | --- |
| Crypto order with no `quote_id` | Fills at the market rate | `400` "price is required when quote_id is not provided"; with a `price`, it's recorded as a `limit` order |
| Cancel a filled order | `422 PRECONDITION_FAILED` | `404 NOT_FOUND` "Order not found or cannot be cancelled"; same for an already-cancelled order |
| Limit sell of USDC/USDT at 1.19 (market about 1.00) | Order rests until the price is reached | Filled immediately. The price must be within 0.80–1.20, so an open order to cancel can't be created on purpose |
| Same crypto order body sent twice | Second is refused | Second gets `422` "Quote has been fully consumed", but a second order with the same reference is still created and stays `pending` (once `rejected`). Lookup by reference then returns that stray order, not the filled one |
| List filter `base_currency: BTC` | BTC-base orders | Orders with BTC on either side (USDT/BTC, USDC/BTC) |
| List body with only `limit` | Applies the limit | HTML `403 Forbidden` from the gateway; `limit` works when sent with another filter |

The list endpoint also returns every order in one page (`has_more: false` at 62 orders), and orders refused for insufficient funds appear in it as `rejected`.

The cancel success path itself works: cancelling the stray `pending` order returned `200` and status `cancelled`.

## Webhooks and balances

Neither webhooks nor balances were reliable during these runs; only polling the order confirmed a swap.

- **No trade webhooks.** Sandbox sent `webhook.test` events to the configured URL but no `trade.completed` or `trade.failed` for any filled order, and the dashboard log lists no trade events.
- **Balances didn't move.** `GET /api/balances/{currency}` returned the same value before and after every filled trade.
- **Balances reset mid-run.** At about 10:53 UTC every balance read 0 and NGN returned `400` "no account found for currency: NGN", for the same company id. NGN trades still filled after that, so the NGN directions were not re-run against an empty balance.
- **Docs vs behavior.** The trading docs describe an order without `quote_id` as a market-rate order. For crypto pairs, sandbox requires a `price` and records it as a `limit` order.

// Signed client for the Bitnob Business API.
const crypto = require("crypto");

function config() {
  const { BITNOB_BASE_URL, BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET } = process.env;
  if (!BITNOB_BASE_URL || !BITNOB_CLIENT_ID || !BITNOB_CLIENT_SECRET) {
    throw new Error("Set BITNOB_BASE_URL, BITNOB_CLIENT_ID and BITNOB_CLIENT_SECRET (run with --env-file)");
  }
  return { baseUrl: BITNOB_BASE_URL, clientId: BITNOB_CLIENT_ID, clientSecret: BITNOB_CLIENT_SECRET };
}

// HMAC-SHA256 over CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD. PAYLOAD is "" for requests without a body.
function sign({ clientId, clientSecret, payload, timestamp, nonce }) {
  return crypto
    .createHmac("sha256", clientSecret)
    .update(`${clientId}:${timestamp}:${nonce}:${payload}`)
    .digest("hex");
}

function authHeaders(clientId, clientSecret, payload) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  return {
    "X-Auth-Client": clientId,
    "X-Auth-Timestamp": timestamp,
    "X-Auth-Nonce": nonce,
    "X-Auth-Signature": sign({ clientId, clientSecret, payload, timestamp, nonce }),
  };
}

// Errors come in two shapes: crypto pairs return { code, detail } (problem+json),
// NGN pairs return { success: false, error: { code, message } }.
class BitnobError extends Error {
  constructor(method, path, status, body) {
    const code = body.code ?? body.error?.code ?? null;
    const detail = body.detail ?? body.error?.message ?? body.message ?? body.title ?? "request failed";
    super(`${method} ${path} -> ${status} ${code ?? ""}: ${detail}`);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.body = body;
  }
}

async function request(method, path, body) {
  const { baseUrl, clientId, clientSecret } = config();
  // Sign the exact string that is sent.
  const payload = body ? JSON.stringify(body) : "";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders(clientId, clientSecret, payload) },
    body: body ? payload : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new BitnobError(method, path, res.status, json);
  return json;
}

module.exports = {
  sign,
  request,
  BitnobError,
  whoami: () => request("GET", "/api/whoami"),
  getBalance: (currency) => request("GET", `/api/balances/${currency}`),
  createQuote: (q) => request("POST", "/api/trading/quotes", q),
  submitOrder: (o) => request("POST", "/api/trading/orders", o),
  getOrder: (idOrRef) => request("GET", `/api/trading/orders/${encodeURIComponent(idOrRef)}`),
};

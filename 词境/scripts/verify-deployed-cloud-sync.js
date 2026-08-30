"use strict";

const assert = require("node:assert/strict");

const endpoint = process.env.WORDSCAPE_SYNC_URL || "https://wordscape.weleuther900.workers.dev/api/sync";
const desktopOrigin = "http://127.0.0.1:4173";

(async () => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: desktopOrigin },
    body: JSON.stringify({ action: "pull", profileId: "f".repeat(64), revision: 0 })
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.status, "missing", `Expected an empty test profile, got ${JSON.stringify(body)}`);
  assert.equal(response.headers.get("access-control-allow-origin"), desktopOrigin, "The desktop origin is not allowed to call cloud sync.");
  console.log(`Deployed cloud sync verification passed: ${endpoint}`);
})().catch((error) => {
  console.error(`Deployed cloud sync verification failed: ${error.message}`);
  process.exitCode = 1;
});

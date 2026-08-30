"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../cloudflare/worker.js"), "utf8").replace("export default", "const handler =") + "\nhandler;";
const worker = vm.runInNewContext(source, { Response, Request, URL, JSON, Number, String, RegExp, console });

function createDatabase() {
  const rows = new Map();
  const chunks = new Map();
  const run = async (statement) => {
    const sql = statement.sql;
    const values = statement.values;
    if (sql.startsWith("INSERT INTO sync_chunks")) {
      const [profileId, revision, index, chunk] = values;
      chunks.set(`${profileId}|${revision}|${index}`, { profile_id: profileId, revision, chunk_index: index, chunk });
    } else if (sql.startsWith("DELETE FROM sync_chunks")) {
      [...chunks.keys()].filter((key) => key.startsWith(`${values[0]}|`)).forEach((key) => chunks.delete(key));
    } else if (sql.startsWith("INSERT INTO sync_profiles")) {
      const [profileId, revision, chunkCount, payload] = values;
      rows.set(profileId, { profile_id: profileId, revision, chunk_count: chunkCount, payload });
    } else if (sql.startsWith("UPDATE sync_profiles")) {
      const [revision, chunkCount, payload, profileId] = values;
      rows.set(profileId, { profile_id: profileId, revision, chunk_count: chunkCount, payload });
    } else if (sql.startsWith("DELETE FROM sync_profiles")) rows.delete(values[0]);
    return { success: true };
  };
  return {
    prepare(sql) {
      const statement = { sql, values: [] };
      statement.bind = (...values) => { statement.values = values; return statement; };
      statement.first = async () => {
        const row = rows.get(statement.values[0]);
        return row ? { ...row } : null;
      };
      statement.all = async () => ({ results: [...chunks.values()].filter((item) => item.profile_id === statement.values[0] && item.revision === statement.values[1]).sort((left, right) => left.chunk_index - right.chunk_index) });
      statement.run = () => run(statement);
      return statement;
    },
    batch: async (statements) => Promise.all(statements.map(run))
  };
}

async function post(env, body) {
  const response = await worker.fetch(new Request("https://wordscape.example/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
  return { status: response.status, body: await response.json() };
}

(async () => {
  const env = { WORDSCAPE_DB: createDatabase(), ASSETS: { fetch: () => new Response("asset") } };
  const id = "a".repeat(64);
  const payloadA = { iv: "aGVsbG8td29ybGQ=", ciphertext: "ciphertext-one-123456".repeat(40000) };
  const payloadB = { iv: "aGVsbG8td29ybGQ=", ciphertext: "ciphertext-two-123456" };
  const resetAt = "2026-08-15T08:00:00.000Z";
  const first = await post(env, { action: "sync", profileId: id, revision: 0, payload: payloadA, resetAt });
  assert.deepEqual(first, { status: 200, body: { status: "saved", revision: 1 } });
  const pulled = await post(env, { action: "pull", profileId: id, revision: 0 });
  assert.equal(pulled.body.status, "found");
  assert.equal(pulled.body.revision, 1);
  assert.equal(pulled.body.resetAt, resetAt, "Pull responses must expose the global reset marker to every device.");
  assert.equal(pulled.body.payload.ciphertext, payloadA.ciphertext);
  const legacyCurrent = await post(env, { action: "pull", profileId: id, revision: 1 });
  assert.equal(legacyCurrent.body.status, "found", "Older installed pages must keep receiving the compatible payload response.");
  assert.equal(legacyCurrent.body.payload.ciphertext, payloadA.ciphertext);
  const current = await post(env, { action: "pull", profileId: id, revision: 1, lightweight: true });
  assert.equal(current.body.status, "current", "An up-to-date client must receive only a lightweight revision check.");
  assert.equal(current.body.revision, 1);
  assert.equal(current.body.resetAt, resetAt);
  assert.equal(current.body.payload, undefined, "The large encrypted snapshot must not be transferred when nothing changed.");
  const conflict = await post(env, { action: "sync", profileId: id, revision: 0, payload: payloadB });
  assert.equal(conflict.body.status, "conflict");
  assert.equal(conflict.body.revision, 1);
  assert.equal(conflict.body.resetAt, resetAt, "Conflicts must preserve the reset marker for stale clients.");
  assert.equal(conflict.body.payload.iv, payloadA.iv);
  assert.equal(conflict.body.payload.ciphertext, payloadA.ciphertext);
  assert.equal(conflict.body.payload.compression, "none");
  const staleReset = await post(env, { action: "sync", profileId: id, revision: 1, payload: payloadB });
  assert.equal(staleReset.body.status, "conflict", "A stale client must not restore records after a global reset.");
  const saved = await post(env, { action: "sync", profileId: id, revision: 1, payload: payloadB, resetAt });
  assert.deepEqual(saved, { status: 200, body: { status: "saved", revision: 2 } });
  const preflight = await worker.fetch(new Request("https://wordscape.example/api/sync", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:4173", "Access-Control-Request-Method": "POST" } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:4173");
  const blockedPreflight = await worker.fetch(new Request("https://wordscape.example/api/sync", { method: "OPTIONS", headers: { Origin: "https://untrusted.example" } }), env);
  assert.equal(blockedPreflight.status, 403);
  const asset = await worker.fetch(new Request("https://wordscape.example/"), env);
  assert.equal(await asset.text(), "asset");
  console.log("Cloud Worker verification passed: pull, save, conflict protection, CORS, and static asset routing.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

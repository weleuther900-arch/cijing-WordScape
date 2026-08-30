const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };
const MAX_PAYLOAD_BYTES = 24 * 1024 * 1024;
const CHUNK_SIZE = 320000;

function reply(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
function isAllowedOrigin(origin) {
  return origin === "https://wordscape.weleuther900.workers.dev" || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin || "");
}
function withCors(response, request) {
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedOrigin(origin)) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Cache-Control");
  response.headers.set("Vary", "Origin");
  return response;
}
function validProfileId(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function validPayload(value) {
  return value && typeof value.iv === "string" && typeof value.ciphertext === "string" && (value.compression === undefined || value.compression === "none" || value.compression === "gzip") && value.iv.length <= 64 && value.ciphertext.length > 16 && value.ciphertext.length <= MAX_PAYLOAD_BYTES;
}
function resetTime(value) { const time = Date.parse(value || ""); return Number.isFinite(time) ? time : 0; }
function validResetAt(value) { return value == null || (typeof value === "string" && resetTime(value) > 0); }
function profileResetAt(profile) {
  try { return JSON.parse(profile?.payload || "{}").resetAt || null; } catch { return null; }
}
function splitPayload(payload) {
  return Array.from({ length: Math.ceil(payload.ciphertext.length / CHUNK_SIZE) }, (_, index) => payload.ciphertext.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
}
async function readPayload(database, profile) {
  const chunkCount = Number(profile.chunk_count) || 0;
  if (!chunkCount) return JSON.parse(profile.payload);
  const { results } = await database.prepare("SELECT chunk FROM sync_chunks WHERE profile_id = ? AND revision = ? ORDER BY chunk_index ASC").bind(profile.profile_id, profile.revision).all();
  if (results.length !== chunkCount) throw new Error("云端同步内容不完整");
  const metadata = JSON.parse(profile.payload);
  return { iv: metadata.iv, ciphertext: results.map((item) => item.chunk).join(""), compression: metadata.compression || "none" };
}
async function writePayload(database, profileId, nextRevision, payload, existing, resetAt) {
  const chunks = splitPayload(payload);
  const metadata = JSON.stringify({ format: "wordscape-encrypted-chunks-v1", iv: payload.iv, compression: payload.compression || "none", ...(resetAt ? { resetAt } : {}) });
  const commands = [];
  if (existing) commands.push(database.prepare("DELETE FROM sync_chunks WHERE profile_id = ?").bind(profileId));
  chunks.forEach((chunk, index) => commands.push(database.prepare("INSERT INTO sync_chunks (profile_id, revision, chunk_index, chunk) VALUES (?, ?, ?, ?)").bind(profileId, nextRevision, index, chunk)));
  if (existing) commands.push(database.prepare("UPDATE sync_profiles SET revision = ?, chunk_count = ?, payload = ?, updated_at = CURRENT_TIMESTAMP WHERE profile_id = ?").bind(nextRevision, chunks.length, metadata, profileId));
  else commands.push(database.prepare("INSERT INTO sync_profiles (profile_id, revision, chunk_count, payload, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(profileId, nextRevision, chunks.length, metadata));
  await database.batch(commands);
}

async function sync(request, env) {
  if (!env.WORDSCAPE_DB) return reply({ error: "云端同步数据库尚未绑定" }, 503);
  let body;
  try { body = await request.json(); } catch { return reply({ error: "请求格式无效" }, 400); }
  const { action = "sync", profileId, revision, payload, resetAt, lightweight } = body || {};
  if (!validProfileId(profileId)) return reply({ error: "同步标识无效" }, 400);
  const requestedRevision = Number(revision);
  if (!Number.isInteger(requestedRevision) || requestedRevision < 0) return reply({ error: "同步版本无效" }, 400);
  if (!validResetAt(resetAt)) return reply({ error: "重置时间无效" }, 400);
  const existing = await env.WORDSCAPE_DB.prepare("SELECT profile_id, revision, chunk_count, payload FROM sync_profiles WHERE profile_id = ?").bind(profileId).first();
  if (action === "pull") {
    if (!existing) return reply({ status: "missing", revision: 0, payload: null });
    const currentRevision = Number(existing.revision);
    const resetAt = profileResetAt(existing);
    // A normal background check must not read and send the complete encrypted
    // snapshot.  For a 10,000-word book that is several megabytes; the client
    // only needs the revision number when it is already up to date.
    // Older installed pages do not understand the lightweight `current`
    // status yet.  Only use it after a client explicitly opts in, otherwise
    // keep the compatible `found` response with its payload.
    if (requestedRevision === currentRevision && lightweight === true) return reply({ status: "current", revision: currentRevision, resetAt });
    return reply({ status: "found", revision: currentRevision, resetAt, payload: await readPayload(env.WORDSCAPE_DB, existing) });
  }
  if (action === "delete") {
    if (!existing) return reply({ status: "deleted" });
    if (requestedRevision !== Number(existing.revision)) return reply({ status: "conflict", revision: Number(existing.revision), payload: await readPayload(env.WORDSCAPE_DB, existing) });
    await env.WORDSCAPE_DB.batch([env.WORDSCAPE_DB.prepare("DELETE FROM sync_chunks WHERE profile_id = ?").bind(profileId), env.WORDSCAPE_DB.prepare("DELETE FROM sync_profiles WHERE profile_id = ?").bind(profileId)]);
    return reply({ status: "deleted" });
  }
  if (action !== "sync" || !validPayload(payload)) return reply({ error: "加密同步内容无效" }, 400);
  const existingResetAt = profileResetAt(existing);
  if (existingResetAt && resetTime(resetAt) < resetTime(existingResetAt)) return reply({ status: "conflict", revision: Number(existing.revision), resetAt: existingResetAt, payload: await readPayload(env.WORDSCAPE_DB, existing) });
  if (!existing) {
    if (requestedRevision !== 0) return reply({ status: "conflict", revision: 0, payload: null });
    await writePayload(env.WORDSCAPE_DB, profileId, 1, payload, null, resetAt);
    return reply({ status: "saved", revision: 1 });
  }
  const currentRevision = Number(existing.revision);
  if (requestedRevision !== currentRevision) return reply({ status: "conflict", revision: currentRevision, resetAt: existingResetAt, payload: await readPayload(env.WORDSCAPE_DB, existing) });
  const nextRevision = currentRevision + 1;
  await writePayload(env.WORDSCAPE_DB, profileId, nextRevision, payload, existing, resetAt || existingResetAt);
  return reply({ status: "saved", revision: nextRevision });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sync") {
      const origin = request.headers.get("Origin");
      if (request.method === "OPTIONS") {
        if (!isAllowedOrigin(origin)) return reply({ error: "来源不被允许" }, 403);
        return withCors(new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }), request);
      }
      if (request.method !== "POST") return withCors(reply({ error: "仅支持 POST" }, 405), request);
      try { return withCors(await sync(request, env), request); } catch (error) {
        console.error("wordscape sync failed", error);
        return withCors(reply({ error: "云端同步暂时失败，请稍后重试" }, 500), request);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

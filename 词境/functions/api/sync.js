const UPSTREAM_SYNC_URL = "https://wordscape.weleuther900.workers.dev/api/sync";

function proxyHeaders(source) {
  const headers = new Headers(source);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  return headers;
}

export async function onRequest({ request }) {
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
  const upstream = await fetch(UPSTREAM_SYNC_URL, {
    method: request.method,
    headers: proxyHeaders(request.headers),
    body,
    redirect: "manual"
  });
  const headers = proxyHeaders(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

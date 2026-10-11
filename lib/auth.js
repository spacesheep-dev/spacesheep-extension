// Signing in: OAuth 2.1 against spacesheep's MCP server, the same door Claude and
// ChatGPT connect through. The extension registers itself (RFC 7591), the person
// approves "Move to spacesheep" on spacesheep.dev, and it gets a token that can
// publish and read spaces but can't mint API keys. Settings → API keys lists the
// connection; revoking it there ends it. Runs in the service worker.

export const SERVER = "https://mcp.spacesheep.dev";
export const CLIENT_NAME = "Move to spacesheep (Chrome)";
const REREGISTER_MS = 300 * 24 * 3600 * 1000; // a registration lives a year on the server

export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/** The MCP origin. `server` in storage points a development build at a local worker. */
export async function serverOrigin() {
  const { server } = await chrome.storage.local.get("server");
  return (server || SERVER).replace(/\/$/, "");
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function s256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

async function jsonOrNull(resp) {
  try { return await resp.json(); } catch { return null; }
}

/** This install's client registration, made once and kept. */
async function clientFor(server) {
  const redirectUri = chrome.identity.getRedirectURL("oauth");
  const { client } = await chrome.storage.local.get("client");
  if (client && client.server === server && client.redirect_uri === redirectUri && Date.now() - client.registered_at < REREGISTER_MS) {
    return client;
  }
  const resp = await fetch(`${server}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = await jsonOrNull(resp);
  if (!resp.ok || !body || !body.client_id) {
    throw new AuthError("unreachable", `spacesheep didn't answer the sign-in (HTTP ${resp.status})`);
  }
  const fresh = { server, client_id: body.client_id, redirect_uri: redirectUri, registered_at: Date.now() };
  await chrome.storage.local.set({ client: fresh });
  return fresh;
}

async function tokenRequest(server, fields) {
  const resp = await fetch(`${server}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const body = await jsonOrNull(resp);
  if (!resp.ok || !body || !body.access_token) {
    const why = (body && (body.error_description || body.error)) || `HTTP ${resp.status}`;
    throw new AuthError(body && body.error === "invalid_grant" ? "revoked" : "unreachable", why);
  }
  return body;
}

async function keep(server, clientId, tokens) {
  const auth = {
    kind: "oauth",
    server,
    client_id: clientId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  };
  await chrome.storage.local.set({ auth });
  return auth;
}

/** Open spacesheep.dev's approval page and wait for the person's answer. */
export async function signIn() {
  const server = await serverOrigin();
  const client = await clientFor(server);
  const verifier = random(32);
  const state = random(16);
  const url = new URL(`${server}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: client.redirect_uri,
    state,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
    scope: "spacesheep:read spacesheep:write",
  }).toString();

  let answer;
  try {
    answer = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  } catch (e) {
    // Closed the window, or the server refused this registration (a stale one
    // shows a page that never redirects). Register afresh next time either way.
    await chrome.storage.local.remove("client");
    throw new AuthError("cancelled", String((e && e.message) || e));
  }
  const back = new URL(answer);
  if (back.searchParams.get("state") !== state) throw new AuthError("cancelled", "the sign-in answered for another request");
  const error = back.searchParams.get("error");
  if (error) throw new AuthError("denied", back.searchParams.get("error_description") || error);
  const code = back.searchParams.get("code");
  if (!code) throw new AuthError("cancelled", "the sign-in came back without a code");

  const tokens = await tokenRequest(server, {
    grant_type: "authorization_code",
    code,
    redirect_uri: client.redirect_uri,
    client_id: client.client_id,
    code_verifier: verifier,
  });
  return keep(server, client.client_id, tokens);
}

// One refresh at a time: a refresh token is single-use, so two at once would
// leave one of them holding a dead token.
let refreshing = null;
function refresh(auth) {
  refreshing ||= tokenRequest(auth.server, {
    grant_type: "refresh_token",
    refresh_token: auth.refresh_token,
    client_id: auth.client_id,
  }).then((tokens) => keep(auth.server, auth.client_id, tokens))
    .catch(async (e) => {
      if (e.code === "revoked") await chrome.storage.local.remove(["auth", "account"]);
      throw e;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * A bearer for the MCP server, or null when there is none and `interactive` is
 * false. `force` skips a token that looks fresh (the server just refused it).
 * A stored `{ kind: "key", key: "ss_…" }` (a development hook) is used as is.
 */
export async function bearer({ interactive = false, force = false } = {}) {
  const server = await serverOrigin();
  const { auth } = await chrome.storage.local.get("auth");
  if (auth && auth.kind === "key") return force ? null : auth.key;
  if (auth && auth.server === server) {
    if (!force && auth.access_token && auth.expires_at > Date.now() + 60_000) return auth.access_token;
    if (auth.refresh_token) {
      try {
        return (await refresh(auth)).access_token;
      } catch (e) {
        if (e.code !== "revoked") throw e;
      }
    }
  }
  if (!interactive) return null;
  return (await signIn()).access_token;
}

export async function isConnected() {
  const server = await serverOrigin();
  const { auth } = await chrome.storage.local.get("auth");
  return !!auth && (auth.kind === "key" || (auth.server === server && !!auth.refresh_token));
}

/** Forget the connection here and end it on the server. */
export async function signOut() {
  const { auth } = await chrome.storage.local.get("auth");
  await chrome.storage.local.remove(["auth", "account"]);
  if (auth && auth.kind === "oauth" && auth.refresh_token) {
    // Revoking the refresh token ends the whole grant; the server answers 200 either way.
    await fetch(`${auth.server}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: auth.refresh_token, client_id: auth.client_id }),
    }).catch(() => {});
  }
}

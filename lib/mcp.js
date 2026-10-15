// A small MCP streamable-HTTP client: the extension is an ordinary client of the
// one remote server every spacesheep surface uses (the CLI's lib/mcp.js, in fetch).
import { extension, browserName } from "./browser.js";
import { bearer, serverOrigin, AuthError } from "./auth.js";

const PROTOCOL = "2025-06-18";
const VERSION = extension.runtime.getManifest().version;

export class McpError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export class Mcp {
  constructor() {
    this.session = null;
    this.nextId = 1;
    this.ready = null;
  }

  async _post(body, { retried = false } = {}) {
    const server = await serverOrigin();
    const token = await bearer({ interactive: false, force: retried });
    if (!token) throw new AuthError("signed_out", "not connected to spacesheep");
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "MCP-Protocol-Version": PROTOCOL,
    };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    let resp;
    try {
      resp = await fetch(`${server}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new McpError("offline", `couldn't reach spacesheep (${(e && e.message) || e})`);
    }
    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (resp.status === 401) {
      // An access token lasts an hour; one refresh, then it really is signed out.
      if (!retried) return this._post(body, { retried: true });
      throw new AuthError("signed_out", "spacesheep refused this connection — connect again");
    }
    if (resp.status === 202 || resp.status === 204) return null;
    const text = await resp.text();
    if (!resp.ok) throw new McpError("server", `spacesheep answered ${resp.status}: ${text.slice(0, 300)}`);
    if ((resp.headers.get("content-type") || "").includes("text/event-stream")) {
      let last = null;
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const msg = JSON.parse(line.slice(5).trim());
          if (msg && msg.id !== undefined && msg.id === body.id) return msg;
          last = msg;
        } catch {}
      }
      return last;
    }
    return text ? JSON.parse(text) : null;
  }

  _init() {
    this.ready ||= (async () => {
      await this._post({
        jsonrpc: "2.0", id: this.nextId++, method: "initialize",
        params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: `spacesheep-${browserName.toLowerCase()}`, version: VERSION } },
      });
      await this._post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  /** Call a tool; its first text block, JSON-parsed when it parses. */
  async call(name, args = {}) {
    await this._init();
    const msg = await this._post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } });
    if (!msg) throw new McpError("server", `no answer from ${name}`);
    if (msg.error) throw new McpError("tool", msg.error.message || JSON.stringify(msg.error));
    const result = msg.result || {};
    const text = (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    let value = text;
    try { value = JSON.parse(text); } catch {}
    if (result.isError) throw new McpError("tool", typeof value === "string" ? value : value.message || value.error || text);
    // The publish guards answer in JSON ({ error, message }) rather than as an error.
    if (value && typeof value === "object" && typeof value.error === "string") {
      throw new McpError(value.error, value.message || value.error);
    }
    return value;
  }
}

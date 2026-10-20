// Firefox for Android has no identity API. Receive the callback in the one tab
// we open, cancelling its request before the authorization code leaves Firefox.
import { extension } from "./browser.js";

export async function firefoxRedirectURL() {
  // Match Firefox's stable identity URL. SHA-1 is only an ID-to-host mapping;
  // the authorization code is protected by the separate S256 PKCE challenge.
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(extension.runtime.id));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `https://${hash}.extensions.allizom.org/`;
}

export async function launchTabAuth(url, redirectUri, timeoutMs = 5 * 60_000) {
  const redirect = new URL(redirectUri);
  // Don't start navigating until the callback and cancellation listeners exist.
  const tab = await extension.tabs.create({ url: "about:blank", active: false });
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      extension.webRequest.onBeforeRequest.removeListener(onRequest);
      extension.tabs.onRemoved.removeListener(onRemoved);
      extension.tabs.remove(tab.id).catch(() => {});
      if (error) reject(error);
      else resolve(answer);
    };
    const onRequest = (details) => {
      if (details.tabId !== tab.id || details.frameId !== 0) return;
      const answer = new URL(details.url);
      if (answer.origin !== redirect.origin || answer.pathname !== redirect.pathname) return;
      finish(null, answer.href);
      return { cancel: true };
    };
    const onRemoved = (id) => {
      if (id === tab.id) finish(new Error("The sign-in tab was closed. Try again when you're ready."));
    };
    try {
      extension.webRequest.onBeforeRequest.addListener(onRequest,
        { urls: [`${redirect.origin}/*`], types: ["main_frame"] }, ["blocking"]);
      extension.tabs.onRemoved.addListener(onRemoved);
      timer = setTimeout(() => finish(new Error("Sign-in timed out. Please try again.")), timeoutMs);
      extension.tabs.update(tab.id, { url, active: true }).catch((error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

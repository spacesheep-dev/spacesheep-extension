// Firefox's browser namespace returns promises; Chrome MV3 does too. Keep the
// choice in one place so both packages run the same application code.
export const extension = globalThis.browser ?? globalThis.chrome;
export const isFirefox = extension?.runtime?.getURL("").startsWith("moz-extension://") ?? false;
export const browserName = isFirefox ? "Firefox" : "Chrome";

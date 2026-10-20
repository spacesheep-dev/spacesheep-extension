// Firefox's browser namespace returns promises; Chrome MV3 does too. Keep the
// choice in one place so both packages run the same application code.
export const extension = globalThis.browser ?? globalThis.chrome;
export const isFirefox = extension?.runtime?.getURL("").startsWith("moz-extension://") ?? false;
export const browserName = isFirefox ? "Firefox" : "Chrome";
// The Android package also runs on desktop Firefox for integration testing.
export const isAndroidBuild = isFirefox && !!extension.runtime.getManifest?.().browser_specific_settings?.gecko_android;

export function resultTabOptions(url, tab) {
  // Android does not implement openerTabId. Let it choose the new tab's position.
  return { url, ...(!isAndroidBuild && tab ? { index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId } : {}) };
}

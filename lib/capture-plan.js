// The server owns tier allowances. Unknown/disconnected accounts preview Free.
export const FREE_CAPTURE = { plan: "free", max_assets: 40 };
export const GREY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAX0lEQVR4nO3PMQ0AMAzAsPLHNlAFscOqFCNI5h03OuBXA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA9oCRSJCO2NFKGQAAAAASUVORK5CYII=";

// Whatever plan the server names, and however many assets it allows, is what this
// account gets. A list of plans or a ceiling kept here goes stale the day the server
// adds a plan, and an account on it then couldn't move anything from a website. Only
// an answer that names no plan, or no whole number of assets, is turned away.
export function capturePolicy(value) {
  if (!value || typeof value.plan !== "string" || !/^[a-z][\w-]{0,39}$/i.test(value.plan) || !Number.isSafeInteger(value.max_assets) || value.max_assets < 0) {
    throw new Error("Couldn’t read your plan’s capture limit. Reopen the extension to try again.");
  }
  return { plan: value.plan, max_assets: value.max_assets, limits: value.limits || {} };
}

export function captureNotice(capture) {
  if (!capture) return "";
  const name = capture.plan.charAt(0).toUpperCase() + capture.plan.slice(1);
  let text = `${name}: ${capture.limit} assets per page.`;
  if (capture.omitted) text += ` ${capture.omitted} left out.`;
  return text;
}

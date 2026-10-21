// The server owns tier allowances. Unknown/disconnected accounts preview Free.
export const FREE_CAPTURE = { plan: "free", max_assets: 40 };
export const GREY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAX0lEQVR4nO3PMQ0AMAzAsPLHNlAFscOqFCNI5h03OuBXA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA9oCRSJCO2NFKGQAAAAASUVORK5CYII=";

export function capturePolicy(value) {
  if (!value || !["free", "pro", "max"].includes(value.plan) || !Number.isInteger(value.max_assets) || value.max_assets < 0 || value.max_assets > 1000) {
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

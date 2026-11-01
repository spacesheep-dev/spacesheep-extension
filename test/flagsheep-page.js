// Runs inside each browser's temporary extension; supplied origin is a local fixture.
import { extension } from "./lib/browser.js";
import { stashPut } from "./lib/stash.js";

const assert = (value, message) => { if (!value) throw new Error(message); };
const ask = (message) => extension.runtime.sendMessage(message);
const until = async (fn) => {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out: " + fn.toString());
};
const frame = async (tabId) => {
  const el = document.createElement("iframe");
  el.src = `popup.html?tab=${tabId}`;
  document.body.append(el);
  await until(() => {
    const problem = el.contentDocument?.querySelector(".problem");
    if (problem) throw new Error(problem.textContent.trim());
    return el.contentDocument?.querySelector("#go");
  });
  return el;
};
const finished = () => until(async () => {
  const { job } = await ask({ type: "state" });
  return ["done", "error"].includes(job?.step) && job;
});
const setPlan = (plan) => fetch(`${origin}/plan`, { method: "POST", body: plan });
const report = (ok) => fetch(`${origin}/report`, { method: "POST", body: JSON.stringify({ ok }) });

try {
  await extension.storage.local.set({ server: origin, auth: { kind: "oauth", server: origin, access_token: "local-access", refresh_token: "local-refresh", expires_at: Date.now() + 3600_000 } });
  const policy = await ask({ type: "capture_limits" });
  assert(policy.ok && policy.policy.plan === "supermax" && policy.policy.max_assets === 1500, "Flagsheep allowance accepted through background messaging: " + JSON.stringify(policy));
  const tab = await extension.tabs.create({ url: `${origin}/site`, active: false });
  await until(async () => {
    const loaded = await extension.tabs.get(tab.id);
    return loaded.url === `${origin}/site` && loaded.status === "complete";
  });

  let pop = await frame(tab.id);
  const notice = "Flagsheep: 1500 assets per page. 1 left out.";
  assert(pop.contentDocument.querySelector(".notes").textContent.includes(notice), "Flagsheep preview uses all 1500 assets and reports overflow");
  pop.contentDocument.querySelector("#go").click();
  await until(() => pop.contentDocument.querySelector("#open"));
  assert(pop.contentDocument.querySelector(".notes").textContent.includes(notice), "Published result keeps Flagsheep label and omissions");
  pop.remove();
  await ask({ type: "seen" });
  await report("Flagsheep preview and publish with 1500 copied assets and one placeholder");

  pop = await frame(tab.id);
  assert(pop.contentDocument.querySelector("#go").textContent.includes("Update"), "Existing space is updated");
  pop.contentDocument.querySelector("#go").click();
  await until(() => pop.contentDocument.querySelector("#open"));
  pop.remove();
  await ask({ type: "seen" });

  // A prepared Flagsheep copy must not publish after a downgrade.
  const jobId = crypto.randomUUID();
  await stashPut(jobId, [{ path: "index.html", html: true, blob: new Blob(["<h1>Prepared copy</h1>"]) }]);
  await setPlan("max");
  await ask({ type: "move", req: { jobId, title: "Changed plan", capture: { plan: "supermax", limit: 1500 }, remember: false } });
  const changed = await finished();
  assert(changed.error?.code === "plan_changed" && changed.error.message.includes("Max plan allows 500"), "Downgrade blocks before publishing");
  await ask({ type: "seen" });
  await setPlan("supermax");

  // Rechecking an older prepared copy uses the public Flagsheep name too.
  const oldId = crypto.randomUUID();
  await stashPut(oldId, [{ path: "index.html", html: true, blob: new Blob(["old copy"]) }]);
  await ask({ type: "move", req: { jobId: oldId, title: "Old preview", capture: { plan: "max", limit: 500 }, remember: false } });
  const upgraded = await finished();
  assert(upgraded.error?.message.includes("Flagsheep plan allows 1500"), "Plan change uses Flagsheep name");
  await ask({ type: "seen" });
  await report("update and plan-change rechecks, including Flagsheep error text");

  const stagedId = crypto.randomUUID();
  await stashPut(stagedId, [{ path: "large.bin", blob: new Blob([new Uint8Array(2 * 1024 ** 2)]) }]);
  await ask({ type: "move", req: { jobId: stagedId, title: "Flagsheep staged upload", kind: "file", remember: false } });
  assert((await finished()).step === "done", "Flagsheep staged file upload succeeds");
  await fetch(`${origin}/complete`, { method: "POST" });
} catch (error) {
  await fetch(`${origin}/report`, { method: "POST", body: JSON.stringify({ error: `${error.message}\n${error.stack || ""}` }) });
}

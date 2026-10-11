// Files on their way from a page (the popup, the move page) to the service worker.
// A message can't carry a big video or a folder of pictures, so the page puts the
// files here as Blobs under a job id and sends only the id; the worker reads them,
// publishes, and drops them. IndexedDB is the extension's own, shared by all its pages.

const DB = "spacesheep-stash";
const STORE = "jobs";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** files: [{ path, blob, html? , optional? }] */
export const stashPut = (id, files) => tx("readwrite", (s) => s.put({ files, at: Date.now() }, id));
export const stashGet = async (id) => ((await tx("readonly", (s) => s.get(id))) || {}).files || null;
export const stashDrop = (id) => tx("readwrite", (s) => s.delete(id));

/** Jobs left behind by a worker that stopped mid-move, older than an hour. */
export async function stashSweep(maxAgeMs = 3600_000) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (!c.value || Date.now() - (c.value.at || 0) > maxAgeMs) c.delete();
        c.continue();
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

# Move to spacesheep

A Chrome extension that publishes the HTML page in your tab to your
[spacesheep.dev](https://spacesheep.dev) account in one click: a report an agent
wrote to your disk, a page on a local dev server, any HTML file. It brings the
images, stylesheets and scripts the page loads from its own folder, and opens the
published page in the next tab, private until you share it.

Press it again on the same page and it updates that space with a new version
instead of making a second one.

## Install

From the Chrome Web Store: *(listing pending)*. More at
[spacesheep.dev/extension](https://spacesheep.dev/extension).

Until then, from a release:

1. Download [move-to-spacesheep.zip](https://github.com/spacesheep-dev/spacesheep-extension/releases/latest/download/move-to-spacesheep.zip)
   (the latest release) and unzip it, or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and pick the unzipped folder.
3. To move files from your computer (`file://` pages), open the extension's
   **Details** and turn on **Allow access to file URLs**. The popup offers to take
   you there the first time it needs it.

The first move opens spacesheep.dev to approve the connection, once. After that
it's one click (or a keyboard shortcut you set at `chrome://extensions/shortcuts`).

## What it reads, and where it goes

- **Only when you click it**, and only the tab you clicked it on (Chrome's
  `activeTab`): the page's own file, and the files it loads from its folder and the
  folders below it. Never anything above that folder, never `<a href>` links, never
  other tabs, history or cookies.
- A page whose words are all drawn by its scripts (a web app) is copied as the tab
  shows it, with those scripts left out. A local file is always copied as written.
- **It sends them to spacesheep and nowhere else**: `mcp.spacesheep.dev`, the same
  server Claude, ChatGPT and the `spacesheep` CLI publish through. There is no
  analytics and no other server.
- Sign-in is OAuth with PKCE. The extension holds a token that can publish and read
  your spaces; it can't create API keys. It's listed under Settings → API keys as
  "OAuth: Move to spacesheep (Chrome)", and revoking it there (or **Disconnect** in
  the popup) ends it.
- Stored on your computer, in the extension's own storage: that token, your
  @handle, and which page went to which space (for "update" instead of a duplicate).

## How it works

| File | Job |
|------|-----|
| `popup.js` | Reads the tab (it holds the click's `activeTab` grant), shows what will move, hands the files to the worker, shows progress. |
| `lib/read.js` | The page and the files beside it. `file://` through the extension's file access, `http(s)` from inside the page (same origin, its own cookies). |
| `lib/refs.js` | Which files a page loads: `src`, `srcset`, stylesheets, icons, `url()` and `@import` in its CSS. Pure; unit-tested. |
| `background.js` | Signs in if needed, publishes (inline under 1.5 MB, staged uploads above), remembers page → space, opens the result. Runs in the service worker so it outlives the popup, which closes when the sign-in window opens. |
| `lib/auth.js` | OAuth 2.1 against spacesheep's MCP server: dynamic client registration, PKCE S256, `chrome.identity.launchWebAuthFlow`, single-use refresh tokens. |
| `lib/mcp.js` | A small MCP streamable-HTTP client: `stage_begin` and `deploy`, the same tools every other spacesheep client calls. |

## Development

```bash
npm install
npm test              # path and CSS rules
npm run e2e           # the real extension in Chromium, against local spacesheep workers
npm run zip           # dist/move-to-spacesheep-<version>.zip for the Chrome Web Store
npm run icons         # redraw icons/icon-*.png from the pixel-art SVGs
```

`npm run e2e` loads the extension in Playwright's Chromium and publishes to a local
spacesheep MCP worker (`SS_MCP`, default `http://localhost:8963`) whose
`API_KEY_1` is `SS_KEY`. Sign-in goes through a stand-in OAuth server in the test
that keeps the real one's contract (registration, PKCE, rotating refresh tokens),
because a local worker's own OAuth bounces through spacesheep.dev. It covers a
`file://` report with its CSS and pictures, updating it in place (and refreshing an
expired token on the way), a staged 2 MB upload, a script-drawn page, a text file,
file access turned off, and disconnecting. Screenshots land in `.e2e/shots/`.

Two development hooks, both in the extension's own storage, which only it can read:
`chrome.storage.local.set({ server: "http://localhost:8963" })` points it at a local
worker (add that origin to `host_permissions` in a local copy of the manifest), and
`popup.html?tab=<id>` opens the popup on a given tab.

## License

MIT

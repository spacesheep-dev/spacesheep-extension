# spacesheep for Chrome

A Chrome extension that moves whatever you have open to your
[spacesheep.dev](https://spacesheep.dev) account in one click: a page, a picture, a
PDF, a video, a text or Markdown file, anything Chrome shows. It gets its own link,
private until you share it, and opens in the next tab.

Click it again on the same thing and it updates that space with a new version
instead of making a second one. Right-click the sheep (or use the popup's link) to
move files or a whole folder from your computer.

| What's in the tab | What the space shows |
|---|---|
| A page from a website | The page as the tab shows it, with the site's own styles, fonts and images it loads |
| An HTML file from your computer | The page as written, with the images, styles and scripts it loads from its folder |
| A picture | The picture, whole; a lighter copy when the original is big, the original as the download |
| A PDF | Its pages as pictures (Chrome won't show a PDF inside a space's frame), each page's words kept for search, readers and agents, and the PDF as the download |
| A video or a sound | A player |
| Markdown, CSV, JSON, code, text | Markdown set as a document, CSV as a table, JSON indented, the rest as written |
| Anything else | Its name and size, and a download button |
| A folder with an `index.html` | The website, as it is |
| Many files | A gallery of the pictures and a list of the rest, each with a page of its own |

## Install

From the Chrome Web Store: *(listing pending)*. More at
[spacesheep.dev/extension](https://spacesheep.dev/extension).

Until then, from a release:

1. Download [spacesheep-extension.zip](https://github.com/spacesheep-dev/spacesheep-extension/releases/latest/download/spacesheep-extension.zip)
   (the latest release) and unzip it, or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and pick the unzipped folder.
3. To move files from your computer that are open in a tab (`file://`), open the
   extension's **Details** and turn on **Allow access to file URLs**. The popup offers
   to take you there the first time it needs it.

The first move opens spacesheep.dev to approve the connection, once. After that
it's one click (or a keyboard shortcut you set at `chrome://extensions/shortcuts`).

## What it reads, and where it goes

- **Only when you click it**, and only the tab you clicked it on (Chrome's
  `activeTab`): the file it shows and, for a page, the files it loads: from a website,
  the site's own files (its styles, fonts and images); from your computer, only the
  page's folder and the folders below it, never anything above that folder. Never
  `<a href>` links, never other tabs, history or cookies. From your computer, only
  the files you pick.
- A page from a website is copied as the tab shows it, with its scripts left out: a
  site's scripts are written for its own server and break on a copy. A local file is
  always copied as written, scripts and all.
- PDFs are drawn into pictures on your computer, by [pdf.js](https://github.com/mozilla/pdf.js)
  inside the extension. Nothing is sent anywhere to do it.
- **It sends files to spacesheep and nowhere else**: `mcp.spacesheep.dev`, the same
  server Claude, ChatGPT and the `spacesheep` CLI publish through. There is no
  analytics and no other server.
- Sign-in is OAuth with PKCE. The extension holds a token that can publish and read
  your spaces; it can't create API keys. It's listed under Settings → API keys as
  "OAuth: spacesheep for Chrome", and revoking it there (or **Disconnect** in the
  popup) ends it.
- Your plan's limits (file size, space size, file count) are checked before anything
  is uploaded. A picture's full-size original is the one thing left out when it
  doesn't fit, and the popup says so.
- Stored on your computer, in the extension's own storage: that token, your
  @handle, and which page went to which space (for "update" instead of a duplicate).

## How it works

| File | Job |
|------|-----|
| `popup.js` | Reads the tab (it holds the click's `activeTab` grant), shows what will move, stashes the files, shows progress. |
| `move.html`, `move.js` | Files and folders from the computer, dropped or picked. |
| `lib/read.js` | What the tab shows: `file://` through the extension's file access, `http(s)` from inside the page (same origin, its own cookies). |
| `lib/refs.js` | Which files a page loads (`src`, `srcset`, stylesheets, icons, `url()` and `@import` in its CSS), and where the copy will look for each one. |
| `lib/kinds.js`, `lib/viewers.js`, `lib/build.js` | What kind of file it is, the page that shows it, and the files of the space. |
| `lib/pdf.js` | A PDF's pages as pictures, with their words (`vendor/pdfjs`). |
| `lib/stash.js` | Files on their way to the service worker, in IndexedDB (a message can't carry a video). |
| `lib/plan.js` | What fits the account's plan, from `stage_begin`'s limits. |
| `background.js` | Signs in if needed, publishes (inline under 1.5 MB, staged uploads above), remembers page → space, opens the result. Runs in the service worker so it outlives the popup, which closes when the sign-in window opens. |
| `lib/auth.js` | OAuth 2.1 against spacesheep's MCP server: dynamic client registration, PKCE S256, `chrome.identity.launchWebAuthFlow`, single-use refresh tokens. |
| `lib/mcp.js` | A small MCP streamable-HTTP client: `stage_begin` and `deploy`, the same tools every other spacesheep client calls. |

## Development

```bash
npm install
npm test              # kinds, viewer pages, Markdown and CSV, plan limits, paths
npm run e2e           # the real extension in Chromium, against local spacesheep workers
npm run zip           # dist/spacesheep-extension-<version>.zip for the Chrome Web Store
npm run icons         # redraw icons/icon-*.png from the pixel-art SVGs
node scripts/vendor-pdfjs.mjs   # after bumping pdfjs-dist
```

`npm run e2e` loads the extension in Playwright's Chromium and publishes to a local
spacesheep MCP worker (`SS_MCP`, default `http://localhost:8963`) whose `API_KEY_1`
is `SS_KEY`. Sign-in goes through a stand-in OAuth server in the test that keeps
the real one's contract (registration, PKCE, rotating refresh tokens), because a
local worker's own OAuth bounces through spacesheep.dev. It covers a `file://` report
with its CSS and pictures, updating it in place (and refreshing an expired token on
the way), a staged 2 MB upload, a script-drawn page, Markdown, a photo too big for
the plan, a PDF tab, the move page with five kinds of file, a folder that is a
website, file access turned off, and disconnecting. Screenshots land in
`.e2e/shots/`.

Two development hooks, both in the extension's own storage, which only it can read:
`chrome.storage.local.set({ server: "http://localhost:8963" })` points it at a local
worker (add that origin to `host_permissions` in a local copy of the manifest), and
`popup.html?tab=<id>` opens the popup on a given tab.

## License

MIT. `vendor/pdfjs` is pdf.js by Mozilla, Apache-2.0 (its `LICENSE` is beside it).

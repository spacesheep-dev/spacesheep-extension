# spacesheep for Chrome and Firefox

A browser extension that moves whatever you have open to your
[spacesheep.dev](https://spacesheep.dev) account in one click: a page, a picture, a
PDF, a video, a text or Markdown file. It gets its own link,
private until you share it, and opens in the next tab.

Click it again on the same thing and it updates that space with a new version
instead of making a second one. Right-click the sheep (or use the popup's link) to
move files or a whole folder from your computer.

| What's in the tab | What the space shows |
|---|---|
| A page from a website | The rendered page with images, styles, fonts and other assets copied from the site and its CDNs |
| An HTML file from your computer | The page as written, with the images, styles and scripts it loads from its folder |
| A picture | The picture, whole; a lighter copy when the original is big, the original as the download |
| A PDF | Its pages as pictures (Chrome won't show a PDF inside a space's frame), each page's words kept for search, readers and agents, and the PDF as the download |
| A video or a sound | A player |
| Markdown, CSV, JSON, code, text | Markdown set as a document, CSV as a table, JSON indented, the rest as written |
| Anything else | Its name and size, and a download button |
| A folder with an `index.html` | The website, as it is |
| Many files | A gallery of the pictures and a list of the rest, each with a page of its own |

## Install

### Chrome

[Add to Chrome from the Chrome Web Store](https://chromewebstore.google.com/detail/spacesheep/aocbmkbjnfohnbnbglcoabbkccnoegpe). More at
[spacesheep.dev/extension](https://spacesheep.dev/extension).

Alternatively, install manually from a release:

1. Download [spacesheep-extension.zip](https://github.com/spacesheep-dev/spacesheep-extension/releases/latest/download/spacesheep-extension.zip)
   (the latest release) and unzip it, or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and pick the unzipped folder.
3. To move files from your computer that are open in a tab (`file://`), open the
   extension's **Details** and turn on **Allow access to file URLs**. The popup offers
   to take you there the first time it needs it.

The first move opens spacesheep.dev to approve the connection, once. After that
it's one click (or a keyboard shortcut you set at `chrome://extensions/shortcuts`).

### Firefox (desktop, version 140 or later)

Download [spacesheep-firefox.zip](https://github.com/spacesheep-dev/spacesheep-extension/releases/latest/download/spacesheep-firefox.zip),
or build the Firefox package from this repository:

```bash
npm install
npm run zip:firefox
```

For a temporary development install, open `about:debugging#/runtime/this-firefox`,
click **Load Temporary Add-on**, and select `dist/firefox/manifest.json` (or the
generated `dist/spacesheep-firefox.zip`). It stays installed until Firefox exits.
The repository root's manifest is for Chrome; load the generated Firefox build.

The ZIP is also the package to submit to [Mozilla Add-ons](https://addons.mozilla.org/developers/)
for review and signing. It is unsigned until then; regular Firefox requires Mozilla
signing for permanent installation. No Firefox store listing is published by the build.
Set a shortcut in `about:addons` → the gear menu → **Manage Extension Shortcuts**.

Website capture, publishing and updating, and the file/folder picker share the
Chrome implementation. In Firefox, use **Move files from your computer** for local
`file://` tabs. Firefox's built-in PDF viewer also blocks script injection: download
the PDF and pick it from your computer. PDFs selected this way still become rendered,
searchable pages. This keeps the Firefox package on `activeTab` without requesting
access to every website or to every local file.

Firefox's install prompt declares website content and authentication information
sent to spacesheep. **Copy link** uses Firefox's clipboard-write permission. There
is no analytics or background browsing collection.

### Firefox for Android (version 142 or later)

Build the Android package separately:

```bash
npm install
npm run zip:firefox-android
```

The output is `dist/spacesheep-firefox-android.zip`. It is **unsigned**: building
does not publish it to Mozilla Add-ons or make it permanently installable in
regular Firefox. Submit this package to Mozilla for signing and Android review
before distributing it. It shares the desktop Firefox add-on ID, so do not
install both packages in the same browser profile.

To install a Mozilla-signed `.xpi` on Android, save it to your phone, open
Firefox **Settings → About Firefox**, and tap the Firefox logo five times
quickly. Return to **Settings → Install Extension from File**, select the
`.xpi`, and tap **Add**. See [Mozilla's installation instructions](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-add-on-from-file-on-android).
Use the signed `.xpi` downloaded from Mozilla, not the unsigned build ZIP.

Once installed, open the page you want to move, then choose **Extensions →
spacesheep** in Firefox's menu and tap **Move to spacesheep**. The first move
opens a sign-in tab; approve the connection and the upload continues after that
tab closes. The result opens in a new tab. **Move files from your device…** opens
the file picker for photos, PDFs and other files. Download PDFs first if Firefox's
viewer prevents capture. Spaces remain private until you share them.

This is a Firefox menu action; it does not add SpaceSheep to Android's system
share sheet or capture pages open in Chrome.

Android has no extension `identity` or `contextMenus` API. Its package replaces
native OAuth with a dedicated tab and PKCE, intercepting only this add-on's
exact Mozilla callback address before the callback request is sent. It requests
`webRequest` / `webRequestBlocking` for that single callback, with
no `tabs` permission. All packages request HTTP/HTTPS host access to copy CDN assets.
Desktop Firefox retains native OAuth and
the toolbar context menu. Android also omits unsupported keyboard commands and
`openerTabId`, and uses a responsive layout with larger touch targets.

To load an unsigned development build temporarily on a phone, install Android
Platform Tools (`adb`), enable Android USB debugging and Firefox's **Remote
debugging via USB**, connect the phone, then run:

```bash
adb devices
npm run run:firefox-android -- --adb-device DEVICE_SERIAL
```

The command targets regular Firefox (`org.mozilla.firefox`) and uses its main
profile. See [Mozilla's Android development guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

Before release, verify on an actual Android device:

- Open an ordinary webpage and invoke the extension from Firefox's menu (this
  checks the real `activeTab` grant, which automated desktop tests cannot grant).
- Complete first-time sign-in, cancel sign-in and retry, move a page, then move
  it again to update the same space.
- Select an image and a downloaded PDF; confirm uploads, PDF rendering, opening
  the result and **Copy link**. Check folder selection on the device's picker.
- Close the popup during sign-in/upload and reopen it to check progress. Keep
  Firefox running during uploads; Android can stop background apps, and interrupted
  transfers do not automatically resume.
- Check a narrow screen, rotation, and a failed/offline upload followed by retry.

`npm run e2e:firefox-android` tests the Android package **in desktop Firefox**,
including the real tab-based OAuth callback, capture, uploads, and phone-width
layouts. It is not a device/emulator test. Device testing and Mozilla signing
are still required before treating this package as release-ready.

## What it reads, and where it goes

- **Only when you click it**, and only the tab you clicked it on (the browser's
  `activeTab`): the file it shows and, for a page, the files it loads: from a website,
  its images, styles, fonts and other assets, including absolute and CDN URLs;
  from your computer, only the page's folder and the folders below it, never anything
  above that folder. Never
  `<a href>` links, never other tabs, history or cookies. From your computer, only
  the files you pick.
- A page from a website is copied as the tab shows it, with its scripts left out: a
  site's scripts are written for its own server and break on a copy. A local file is
  always copied as written, scripts and all.
- Web assets are uploaded with the HTML to Cloudflare R2. References in HTML,
  responsive images, inline styles, stylesheets, SVGs and embedded HTML are rewritten
  to those copies. CSS imports and their dependencies are followed; redirected
  stylesheets resolve URLs from their final address. Query-string variants get
  separate files. Navigation links still lead to their original destinations.
- HTTP/HTTPS host access lets the extension download CDN files that don't allow
  cross-origin page requests. Capture still starts only when you open the extension.
  Same-origin reads use the tab's authenticated context; cookies themselves aren't
  copied or uploaded. Reloading/updating the extension may require approving the
  expanded browser permissions.
- Webpage capture includes up to 40 supporting assets on Free, 150 on Pro, or 500 on Max (HTML and generated placeholders do not count). The extension reads the allowance from the account before capture and checks it again before publishing. Excess images use an embedded grey PNG; other excess assets are omitted, with the plan and omitted count shown before and after publishing. Capture is also bounded to 25 MB per asset and 100 MB total; upload size limits still apply.
  Unavailable and oversized assets are reported in the popup and replaced
  by empty references. Skipped assets never silently load from the original site. Temporary
  `blob:` resources aren't copied. A page with skipped assets will be incomplete.
- PDFs are drawn into pictures on your computer, by [pdf.js](https://github.com/mozilla/pdf.js)
  inside the extension. Nothing is sent anywhere to do it.
- **It sends files to spacesheep and nowhere else**: `mcp.spacesheep.dev`, the same
  server Claude, ChatGPT and the `spacesheep` CLI publish through. There is no
  analytics and no other server.
- Sign-in is OAuth with PKCE. The extension holds a token that can publish and read
  your spaces; it can't create API keys. It's listed under Settings → API keys as
  "OAuth: spacesheep for Chrome" or "OAuth: spacesheep for Firefox", and revoking it there (or **Disconnect** in the
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
| `background.js` | Signs in if needed, publishes (inline under 1.5 MB, staged uploads above), remembers page → space, opens the result. Runs in Chrome's service worker or Firefox's event page so it outlives the popup. |
| `lib/browser.js` | Selects the browser's Promise-based extension API and browser name. |
| `lib/auth.js`, `lib/oauth-tab.js` | OAuth 2.1 against spacesheep's MCP server: dynamic client registration, PKCE S256, native desktop sign-in or an Android sign-in tab, single-use refresh tokens. |
| `lib/mcp.js` | A small MCP streamable-HTTP client: `stage_begin` and `deploy`, the same tools every other spacesheep client calls. |
| `scripts/package.mjs` | Builds each browser from the shared runtime files; supplies Firefox's event-page manifest, stable add-on ID and data-consent declarations. |

## Development

```bash
npm install
npm test              # kinds, viewer pages, Markdown and CSV, plan limits, paths
npm run e2e           # the real extension in Chromium, against local spacesheep workers
npm run zip           # dist/spacesheep-extension-<version>.zip for the Chrome Web Store
npm run zip:firefox   # dist/spacesheep-firefox-<version>.zip for Mozilla Add-ons
npm run build:firefox # unpacked extension in dist/firefox/
npm run lint:firefox  # Mozilla's validator (see known vendor warnings below)
npx playwright install firefox
npm run e2e:firefox   # real Firefox with local OAuth/MCP stand-ins; no account needed
npm run e2e:capture   # real Chromium capture + offline render; no account needed
npm run lint:firefox-android # validate the Android manifest and runtime
npm run e2e:firefox-android  # Android package in desktop Firefox, not a device test
npm run zip:firefox-android # separate unsigned Android package
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

The Firefox integration test checks native OAuth with PKCE, refresh and revocation,
page capture with authenticated assets, the popup's publish/update flow, bundled PDF
rendering, the file picker, and a staged upload after all extension views close.
It uses a temporary profile and a temporary build with localhost access, then removes
both. `FIREFOX_BINARY` selects another Firefox executable; `HEADED=1` shows the browser.
All packages grant HTTP/HTTPS host access for asset downloads; Android also
declares this add-on's single OAuth callback host for callback interception.

The capture integration test uses two local origins, including a CDN without CORS
headers, and checks authenticated images, redirects, query variants, nested CSS,
fonts, SVG references, responsive images and embedded documents. It then stops both
source servers and renders the saved files, checking that no external assets load.

On macOS 27, Playwright's bundled Firefox can hang before loading the extension
because it shares Firefox's protected application-data directory
([upstream issue](https://github.com/microsoft/playwright/issues/42768)). The Linux
CI job avoids this; local automation can use `FIREFOX_BINARY` with a test-only
launcher that gives Firefox a separate application identity, as described there.
Loading the temporary add-on in the Firefox app also works.

Mozilla's validator reports dynamic-import warnings inside the unmodified vendored
pdf.js files, plus an Android data-consent version warning (the package targets desktop
Firefox and its minimum is ESR 140). These need review when submitting to AMO; they
are not validation errors. The app's PDF import is a fixed local path.

Two development hooks, both in the extension's own storage, which only it can read:
`chrome.storage.local.set({ server: "http://localhost:8963" })` points it at a local
worker, and
`popup.html?tab=<id>` opens the popup on a given tab.

## License

MIT. `vendor/pdfjs` is pdf.js by Mozilla, Apache-2.0 (its `LICENSE` is beside it).

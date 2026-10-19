# Firefox listing screenshots

Three 2400 × 1800 JPEG compositions, exported to `dist/store-screenshots/`:

1. `01-save-the-page.jpg` — capture a styled web page.
2. `02-readable-pdf.jpg` — choose a local PDF and preview its readable page.
3. `03-folder-to-website.jpg` — move a website folder with its assets.

These are promotional compositions with fictional demo content, not screenshots of published customer spaces. Popup and picker panels reuse the extension's HTML/CSS with staged values; the PDF is rendered by the extension's real `drawPdf` and `pdfPage` functions. The PDF composition hides the empty drop area to focus on the selected document. Browser frames are presentation elements. No account connection or upload occurs.

Regenerate the sample PDF with `python3 store-assets/screenshots/demo_pdf.py` (requires reportlab). Run `node store-assets/screenshots/serve.mjs` from the repository, then open `http://127.0.0.1:4178/store-assets/screenshots/index.html?n=1` (or `n=2`, `n=3`). Capture each entire fixed-size page as JPEG. Wait for the PDF preview to finish rendering before capturing image 2.

The layout is deliberately fixed at the listing export size. Production extension files are unchanged.

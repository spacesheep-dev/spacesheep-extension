# Asset capture smoke-test screenshots

Captured locally with the synthetic `asset-smoke` account. No production account
data or credentials appear in these images.

- `limit-copy-before.png`: earlier local implementation, before copy polish;
  340 × 360 viewport, body capture 340 × 372. This is an intermediate UI state,
  not the main-branch baseline.
- `limit-copy-after.png`: final Free capture review; 340 × 620 viewport,
  body capture 340 × 318. The 45-image fixture keeps 40 assets and reports 5 left out.
- `published.png`: final successful publish; 340 × 620 viewport,
  body capture 340 × 308. The allowance notice remains visible.
- `saved-free-page.jpg`: saved fixture in the local app; 998 × 940 viewport.
  Forty images were stored; five excess images use embedded grey PNGs.
- `local-preview-before.jpg`: broken local preview before the MIME/binary fix;
  1200 × 1064 browser-window capture including browser chrome. The original
  content viewport was not recorded separately.
- `local-preview-after.jpg`: corrected local preview; 998 × 940 viewport.
  The Wikipedia Dorper page renders copied CSS and Wikimedia images.

The Wikipedia captures show the public [Dorper article](https://en.wikipedia.org/wiki/Dorper).
Article and media attribution remains with Wikipedia and the linked Wikimedia
Commons contributors. The full-asset capture predates the tier cap and demonstrates
the local preview fix; the synthetic fixture demonstrates the final Free allowance.

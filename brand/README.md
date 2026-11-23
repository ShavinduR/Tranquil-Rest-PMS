# Tranquil Rest brand

- `logo-original.webp`: the logo as supplied by the owner (1600×2000).
- `public/logo.svg`: vector redraw, matched against the original by overlay. Use this everywhere.
- `public/logo-white.svg`: white version for green backgrounds.
- `public/favicon.svg`: same artwork on a square canvas.
- PWA / iOS icons (`public/pwa-*.png`, `apple-touch-icon.png`) are generated from `logo.svg`: `node scripts/make-icons.mjs`.

**Brand green:** `#09714E`. In the app it is Tailwind's `teal-700`; the whole `teal-*` ramp is remapped to brand
greens in `src/index.css`, so `teal-50 … teal-950` are all tints and shades of the logo colour.
It also passes the chart-colour checks (lightness, chroma, ≥3:1 on white), so the dashboard charts use it directly.

The caretaker room-status colours (green / red / orange / blue) are deliberately **not** brand colours. They are
traffic-light signals and must stay distinct from the brand green.

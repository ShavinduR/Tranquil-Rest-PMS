// Renders public/logo.svg into the PNG icons the PWA manifest and iOS need.
// White background so the brand-green logo reads clearly on any home screen.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8');
const shots = [
  // [file, size, logo height as share of the icon]
  ['pwa-192.png', 192, 0.8],
  ['pwa-512.png', 512, 0.8],
  ['apple-touch-icon.png', 180, 0.72],
  ['pwa-maskable-512.png', 512, 0.6], // Android may crop to a circle: keep inside the 80% safe zone
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, share] of shots) {
  const h = Math.round(size * share);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:#fff;display:grid;place-items:center;width:${size}px;height:${size}px">
    ${svg.replace('<svg ', `<svg height="${h}" width="${Math.round(h * 0.8)}" `)}</body>`);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname });
}
await browser.close();

// Renders public/favicon.svg into the PNG icons the PWA manifest needs.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const shots = [
  ['pwa-192.png', 192, 0, 112],
  ['pwa-512.png', 512, 0, 112],
  ['apple-touch-icon.png', 180, 0, 0],
  ['pwa-maskable-512.png', 512, 0.1, 0],
];
for (const [file, size, pad, radius] of shots) {
  const inner = Math.round(size * (1 - pad * 2));
  const body = svg.replace('rx="112"', `rx="${radius}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:#0f766e;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${body.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: radius > 0 });
}
await browser.close();

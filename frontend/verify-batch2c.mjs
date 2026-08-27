import { chromium } from 'playwright';
const shotDir = '/tmp/claude-1000/-home-meet-Desktop-PA-Model-1/fbafb27e-090d-4082-8eb4-08b6a8a339ef/scratchpad/pixel-check';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

await page.goto('http://localhost:5173/login');
await page.fill('input[type="email"]', 'admin@sentinel.local');
await page.fill('input[type="password"]', 'Sentinel@2026');
await page.click('button[type="submit"]');
await page.waitForURL('**/overview', { timeout: 10000 }).catch(() => {});
await page.click('a[href="/cameras"]');
await page.waitForTimeout(1000);

// Click the visible rounded-full department badge span inside the first data row (not the filter dropdown option)
const badge = await page.$('table, div >> text=Home Department (Police)');
const badges = await page.$$('span.rounded-full:has-text("Home Department")');
console.log('badges found:', badges.length);
if (badges.length > 0) {
  await badges[0].click();
  await page.waitForURL('**/cameras/*', { timeout: 8000 }).catch(() => {});
}
console.log('URL after click:', page.url());
console.log('Row click works:', /\/cameras\/[a-f0-9-]{36}$/.test(page.url()));

await page.waitForTimeout(1000);
await page.screenshot({ path: `${shotDir}/camera-detail.png`, fullPage: true });
await browser.close();

import { chromium } from 'playwright';
const BASE = 'https://ask-evon.vercel.app';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => console.log('[browser]', msg.type(), msg.text().slice(0, 500)));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'cxo@evon.com');
await page.fill('input[type="password"]', 'Password123!');
await page.click('button[type="submit"]');
await page.waitForURL(/\/chat/, { timeout: 20000 });

await page.click('text=New chat');
await page.waitForURL(/\/chat$/, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(800);
await page.fill('textarea, input[placeholder*="Message"]', 'What is the Julius case study about?');
await page.keyboard.press('Enter');
await page.locator('button:has-text("Regenerate")').first().waitFor({ timeout: 60000 });
await page.waitForTimeout(500);

const chips = await page.locator('button[title*="Preview cited passage"]').allInnerTexts();
console.log('citations:', chips);

const citationChip = page.locator('button[title*="Preview cited passage"]').first();
await citationChip.click();
await page.locator('canvas').or(page.locator("text=/An in-browser page preview isn't available/")).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1000);
const pageLabel = await page.locator('text=/^Page \\d+$/').first().innerText().catch(() => 'unknown');
console.log('page shown:', pageLabel);
const highlightCount = await page.locator('.pdf-highlight').count();
console.log('highlight span count:', highlightCount);
const bodyText = await page.locator('body').innerText();
console.log('highlighted caption present:', bodyText.includes('Highlighted text is what this answer actually cited'));

await browser.close();

import { chromium } from 'playwright';
const BASE = 'https://ask-evon.vercel.app';
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'cxo@evon.com');
await page.fill('input[type="password"]', 'Password123!');
await page.click('button[type="submit"]');
await page.waitForURL(/\/chat/, { timeout: 20000 });

const QUESTIONS = [
  'What is the Julius case study about?',
  'What does the DevSecOps guidelines document cover?',
  'What is in the Rate Card document?',
];

for (const question of QUESTIONS) {
  await page.click('text=New chat');
  await page.waitForURL(/\/chat$/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const input = page.locator('textarea, input[placeholder*="Message"]');
  await input.fill(question);
  await page.keyboard.press('Enter');

  await page.locator('button:has-text("Regenerate")').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  const citationChip = page.locator('button[title*="Preview cited passage"]').first();
  const docName = await citationChip.innerText();
  await citationChip.click();
  await page.locator('canvas').or(page.locator("text=/An in-browser page preview isn't available/")).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const bodyText = await page.locator('body').innerText();
  const highlighted = bodyText.includes('Highlighted text is what this answer actually cited');
  console.log(`"${question}" -> ${docName}: highlighted=${highlighted}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

await browser.close();

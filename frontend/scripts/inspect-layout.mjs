import { chromium } from '../node_modules/@playwright/test/index.mjs';
import fs from 'fs';
import path from 'path';

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
];

const URL = process.env.TARGET_URL || 'http://localhost:4173';
const OUT_DIR = path.resolve(process.env.OUT_DIR || 'screenshots/after');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Auditing target URL: ${URL}`);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(URL, { waitUntil: 'networkidle' });

    // Dismiss welcome modal if open to inspect primary screen
    const welcomeCloseBtn = page.locator('button:has-text("Explore on My Own"), button:has-text("Skip")').first();
    if (await welcomeCloseBtn.isVisible()) {
      await welcomeCloseBtn.click();
      await page.waitForTimeout(500);
    }

    // Measure document scrollWidth vs clientWidth
    const pageMetrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const header = document.querySelector('header');
      const nav = document.querySelector('nav');
      const main = document.querySelector('main');

      // Find any element with scrollWidth > clientWidth
      const allElements = Array.from(document.querySelectorAll('*'));
      const overflowingElements = allElements
        .filter((el) => {
          const style = window.getComputedStyle(el);
          // Ignore html and body for internal overflow checks
          if (el === doc || el === body) return false;
          return el.scrollWidth > el.clientWidth && style.overflowX !== 'hidden' && el.clientWidth > 0;
        })
        .map((el) => ({
          tagName: el.tagName,
          className: el.className,
          id: el.id,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          difference: el.scrollWidth - el.clientWidth,
          overflowX: window.getComputedStyle(el).overflowX,
        }));

      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        hasPageHorizontalOverflow: doc.scrollWidth > doc.clientWidth,
        header: header ? {
          scrollWidth: header.scrollWidth,
          clientWidth: header.clientWidth,
          offsetWidth: header.offsetWidth,
        } : null,
        nav: nav ? {
          scrollWidth: nav.scrollWidth,
          clientWidth: nav.clientWidth,
          offsetWidth: nav.offsetWidth,
          overflowX: window.getComputedStyle(nav).overflowX,
        } : null,
        overflowingElements: overflowingElements.slice(0, 10),
      };
    });

    console.log(`\n=== Viewport: ${vp.name} (${vp.width}x${vp.height}) ===`);
    console.log(`Doc scrollWidth: ${pageMetrics.docScrollWidth}, clientWidth: ${pageMetrics.docClientWidth}, Page Overflow: ${pageMetrics.hasPageHorizontalOverflow}`);
    if (pageMetrics.header) {
      console.log(`Header: scrollWidth=${pageMetrics.header.scrollWidth}, clientWidth=${pageMetrics.header.clientWidth}`);
    }
    if (pageMetrics.nav) {
      console.log(`Nav: scrollWidth=${pageMetrics.nav.scrollWidth}, clientWidth=${pageMetrics.nav.clientWidth}, diff=${pageMetrics.nav.scrollWidth - pageMetrics.nav.clientWidth}, overflowX=${pageMetrics.nav.overflowX}`);
    }
    if (pageMetrics.overflowingElements.length > 0) {
      console.log('Elements with scrollWidth > clientWidth:');
      for (const el of pageMetrics.overflowingElements) {
        console.log(`  - <${el.tagName} class="${el.className.slice(0, 50)}"> scrollW=${el.scrollWidth} clientW=${el.clientWidth} diff=${el.difference} overflowX=${el.overflowX}`);
      }
    }

    const screenshotPath = path.join(OUT_DIR, `${vp.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved: ${screenshotPath}`);
  }

  await browser.close();
}

run().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});

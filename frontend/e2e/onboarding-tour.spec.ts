import { test, expect } from '@playwright/test';

test.describe('Onboarding Tour, Brand Identity, and Responsive Design', () => {
  test('first-time visitor sees welcome modal and completes the 5-step interactive tour', async ({ page }) => {
    // Ensure clean storage to simulate a first-time visitor
    await page.goto('/');

    // 1. Welcome Modal appears
    await expect(page.getByText('Welcome to Data Rewind')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Investigate a data pipeline failure/)).toBeVisible();

    // 2. Click "Start Guided Tour"
    const startTourBtn = page.getByRole('button', { name: /Start Guided Tour/i });
    await expect(startTourBtn).toBeVisible();
    await startTourBtn.click();

    // 3. Tour Step 1 of 5
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    await expect(page.getByText('Choose a Pipeline Failure Scenario')).toBeVisible();

    // Advance to Step 2
    await page.getByRole('button', { name: /Next/i }).click();

    // 4. Tour Step 2 of 5
    await expect(page.getByText('Step 2 of 5')).toBeVisible();
    await expect(page.getByText('Execute Forensic Investigation')).toBeVisible();

    // Test Back button
    await page.getByRole('button', { name: /Back/i }).click({ force: true });
    await expect(page.getByText('Step 1 of 5')).toBeVisible();

    // Advance forward
    await page.getByRole('button', { name: /Next/i }).click({ force: true });
    await expect(page.getByText('Step 2 of 5')).toBeVisible();

    await page.getByRole('button', { name: /Next/i }).click({ force: true });
    await expect(page.getByText('Step 3 of 5')).toBeVisible();
    await expect(page.getByText('Identify Earliest Observable Divergence (EOD)')).toBeVisible();

    await page.getByRole('button', { name: /Next/i }).click({ force: true });
    await expect(page.getByText('Step 4 of 5')).toBeVisible();
    await expect(page.getByText('Inspect Evidence & Lineage Graph')).toBeVisible();

    await page.getByRole('button', { name: /Next/i }).click({ force: true });
    await expect(page.getByText('Step 5 of 5')).toBeVisible();
    await expect(page.getByText('Verify Candidate Fix with Tri-Run Evaluation')).toBeVisible();

    // 5. Finish Tour
    const finishBtn = page.getByRole('button', { name: /Finish Tour/i });
    await expect(finishBtn).toBeVisible();
    await finishBtn.click({ force: true });

    // Tour dialog should be dismissed
    await expect(page.getByText('Step 5 of 5')).not.toBeVisible();

    // 6. Reload page - returning visitor should not be prompted with welcome modal
    await page.reload();
    await expect(page.getByText('Welcome to Data Rewind')).not.toBeVisible();

    // 7. Restart tour manually from Header action
    const tourBtn = page.getByRole('button', { name: /Guided Tour/i });
    await expect(tourBtn).toBeVisible();
    await tourBtn.click();

    await expect(page.getByText('Step 1 of 5')).toBeVisible();

    // Skip tour
    await page.getByRole('button', { name: /Skip Tour/i }).click();
    await expect(page.getByText('Step 1 of 5')).not.toBeVisible();
  });

  test('verifies favicon, brand mark, and metadata integrity', async ({ page }) => {
    // Set tour completed to prevent modal overlay
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });

    await page.goto('/');

    // 1. Page Title and Metadata
    await expect(page).toHaveTitle(/Data Rewind/);
    const metaDescription = page.locator('meta[name="description"]');
    await expect(metaDescription).toHaveAttribute(
      'content',
      /Trace unexpected output changes to the pipeline step that caused them/
    );

    // 2. Favicon SVG link
    const faviconLink = page.locator('link[rel="icon"]');
    await expect(faviconLink).toHaveAttribute('href', '/favicon.svg');

    // 3. Check favicon resource returns HTTP 200
    const faviconResponse = await page.request.get('/favicon.svg');
    expect(faviconResponse.status()).toBe(200);
    const svgBody = await faviconResponse.text();
    expect(svgBody).toContain('<svg');
  });

  test('verifies zero page-level horizontal overflow across all required viewports', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });

    const viewports = [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Verify no horizontal document overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      });
      expect(overflow).toBe(true);

      // Verify header and primary action remain visible
      await expect(page.getByText('DATA REWIND', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Run Investigation/i })).toBeVisible();
    }
  });
});

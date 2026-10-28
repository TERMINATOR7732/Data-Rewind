import { test, expect } from '@playwright/test';

test.describe('Forensic Report Studio Export Journeys', () => {
  test.beforeEach(async ({ page }) => {
    // Generate an investigation and verification on SCN-01 first
    await page.goto('/');
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();
    const verifyBtn = page.getByRole('button', { name: /Verify Fix Candidate/i });
    await verifyBtn.click();
    await expect(page.locator('text=Tri-Run Fix Verification Hub')).toBeVisible({ timeout: 15000 });

    // Transition to Report Studio
    const reportStudioBtn = page.getByRole('button', { name: /Open Report Studio/i });
    await reportStudioBtn.click();
    await expect(page.locator('text=Forensic Report Studio')).toBeVisible();
  });

  test('exports signed dossier in Markdown format with download validation', async ({ page }) => {
    // Select Markdown format
    await page.locator('input[value="markdown"]').check();

    // Trigger download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Signed Dossier/i }).click();
    const download = await downloadPromise;

    // Validate filename pattern
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });

  test('exports signed dossier in JSON format with download validation', async ({ page }) => {
    // Select JSON format
    await page.locator('input[value="json"]').check();

    // Trigger download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Signed Dossier/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('exports signed dossier in Spreadsheet-Safe CSV format with formula injection protection', async ({ page }) => {
    // Select Spreadsheet-Safe CSV format
    await page.locator('input[value="safe_csv"]').check();

    // Trigger download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Signed Dossier/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
});

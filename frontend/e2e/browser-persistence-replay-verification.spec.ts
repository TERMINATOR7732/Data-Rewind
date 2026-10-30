import { test, expect } from '@playwright/test';

test.describe('Browser-Side Persistence, Replay & Verification Journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('verifies workspace retention, tri-run verification, and report download capability', async ({ page }) => {
    await page.goto('/');

    // 1. Check Workspace Storage & Retention page
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await expect(page.locator('text=Workspace Storage & Data Privacy')).toBeVisible();
    await expect(page.locator('text=Reference-Aware Garbage Collection')).toBeVisible();
    await expect(page.getByRole('button', { name: /Run Garbage Collection/i })).toBeVisible();

    // 2. Run Garbage Collection
    await page.getByRole('button', { name: /Run Garbage Collection/i }).click();
    await expect(page.locator('text=Reference-aware Garbage Collection freed')).toBeVisible({ timeout: 10000 });

    // 3. Navigate to Demo Sandbox & run Tri-Run verification
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();
    const select = page.locator('select');
    await select.selectOption('clean');
    const verifyBtn = page.getByRole('button', { name: /Verify Fix Candidate/i });
    await verifyBtn.click();

    // 4. Verify Tri-Run Verification Hub display
    await expect(page.locator('text=Tri-Run Fix Verification Hub')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('VERIFIED CLEAN', { exact: true })).toBeVisible();

    // 5. Navigate to Report Studio
    const reportStudioBtn = page.getByRole('button', { name: /Open Report Studio/i });
    await expect(reportStudioBtn).toBeVisible();
    await reportStudioBtn.click();

    // 6. Inspect Report Studio controls
    await expect(page.locator('text=Forensic Report Studio (SPEC-MOD-05 §2)')).toBeVisible();
    await expect(page.locator('text=Spreadsheet-Safe CSV')).toBeVisible();
    await expect(page.locator('text=Raw Bit-for-Bit CSV')).toBeVisible();
    await expect(page.locator('text=Markdown Dossier')).toBeVisible();
    await expect(page.locator('text=Machine JSON')).toBeVisible();

    // 7. Click Download Signed Dossier
    const downloadBtn = page.getByRole('button', { name: /Download Signed Dossier/i });
    await expect(downloadBtn).toBeVisible();
  });
});

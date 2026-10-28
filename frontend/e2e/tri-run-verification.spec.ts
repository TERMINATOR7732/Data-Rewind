import { test, expect } from '@playwright/test';

test.describe('Tri-Run Fix Verification Hub Journeys', () => {
  test('verifies dual-axis evaluation, evidence items, and transitions to report studio', async ({ page }) => {
    await page.goto('/');

    // 1. Run tri-run verification on SCN-01 from Demo Hub
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();
    const select = page.locator('select');
    await select.selectOption('clean');
    const verifyBtn = page.getByRole('button', { name: /Verify Fix Candidate/i });
    await verifyBtn.click();

    // 2. Hub header and verdict pill
    await expect(page.locator('text=Tri-Run Fix Verification Hub')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('VERIFIED CLEAN', { exact: true })).toBeVisible();

    // 3. Dual-Axis cards
    await expect(page.locator('text=Axis 1: Remediation Evaluation')).toBeVisible();
    await expect(page.locator('text=Axis 2: Baseline Equivalence')).toBeVisible();

    // 4. Evidence Chain section
    await expect(page.locator('text=Multi-Tier Evidence Chain')).toBeVisible();

    // 5. Click "Open Report Studio" button to transition
    const reportStudioBtn = page.getByRole('button', { name: /Open Report Studio/i });
    await expect(reportStudioBtn).toBeVisible();
    await reportStudioBtn.click();

    // Verify Report Studio is displayed
    await expect(page.locator('text=Forensic Report Studio')).toBeVisible();
  });
});

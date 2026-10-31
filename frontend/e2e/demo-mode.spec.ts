import { test, expect } from '@playwright/test';

test.describe('Demo Mode End-to-End Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('discovers pre-loaded scenarios SCN-01 to SCN-04 and renders metadata', async ({ page }) => {
    await page.goto('/');

    // Ensure Demo Sandbox tab is active
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();

    // Verify all 4 canonical scenarios are listed
    await expect(page.locator('text=scn01').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=scn02').first()).toBeVisible();
    await expect(page.locator('text=scn03').first()).toBeVisible();
    await expect(page.locator('text=scn04').first()).toBeVisible();

    // SCN-01 metadata verification
    await expect(page.locator('text=Upstream Vendor Input Data Drift').first()).toBeVisible();
    await expect(page.locator('text=Expected EOD: ingest_orders')).toBeVisible();
  });

  test('executes SCN-01 investigation and navigates to lineage & diff view', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();

    // Click SCN-01
    await page.locator('div:has-text("scn01")').first().click();

    // Click "Run Investigation"
    const runBtn = page.getByRole('button', { name: /Run Investigation/i });
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    // Should transition to Investigation & Lineage tab
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
    const eodCard = page.locator('[data-tour="eod-card"]');
    await expect(eodCard).toBeVisible();
    await expect(eodCard.getByText('Earliest Observable Divergence')).toBeVisible();
    await expect(eodCard.getByText('ingest_orders')).toBeVisible();

    // Verify Diff Table is displayed with row differences
    await expect(page.getByRole('button', { name: /All Rows/i })).toBeVisible();
  });

  test('executes tri-run fix verification in clean mode and renders VERIFIED CLEAN verdict', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();

    // Select clean fix mode
    const select = page.locator('select');
    await select.selectOption('clean');

    // Click "Verify Fix Candidate"
    const verifyBtn = page.getByRole('button', { name: /Verify Fix Candidate/i });
    await verifyBtn.click();

    // Should transition to Fix Verification tab
    await expect(page.locator('text=Tri-Run Fix Verification Hub')).toBeVisible({ timeout: 15000 });

    // Assert VERIFIED CLEAN verdict card
    await expect(page.getByText('VERIFIED CLEAN', { exact: true })).toBeVisible();
    await expect(page.locator('text=Axis 1: Remediation Evaluation')).toBeVisible();
    await expect(page.locator('text=Axis 2: Baseline Equivalence')).toBeVisible();
  });

  test('executes tri-run fix verification in unresolved mode and renders REGRESSION UNRESOLVED verdict', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();

    // Select unresolved mode
    const select = page.locator('select');
    await select.selectOption('unresolved');

    // Click "Verify Fix Candidate"
    const verifyBtn = page.getByRole('button', { name: /Verify Fix Candidate/i });
    await verifyBtn.click();

    // Should transition to Fix Verification tab
    await expect(page.locator('text=Tri-Run Fix Verification Hub')).toBeVisible({ timeout: 15000 });

    // Assert REGRESSION UNRESOLVED verdict card
    await expect(page.locator('text=REGRESSION UNRESOLVED')).toBeVisible();
  });
});

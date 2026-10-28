import { test, expect } from '@playwright/test';

test.describe('Comparison & Lineage Canvas Journeys', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate and run SCN-01 to populate active investigation
    await page.goto('/');
    await page.getByRole('button', { name: 'Demo Sandbox' }).click();
    await page.locator('div:has-text("scn01")').first().click();
    const runBtn = page.getByRole('button', { name: /Run Investigation/i });
    await runBtn.click();
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
  });

  test('toggles between Graph Canvas and Accessible Table fallback', async ({ page }) => {
    // Verify Graph Canvas is default
    await expect(page.locator('text=Pipeline DAG Lineage & Divergence Canvas')).toBeVisible();

    // Toggle to Accessible Table
    const tableToggleBtn = page.getByRole('button', { name: /Accessible Table/i });
    await expect(tableToggleBtn).toBeVisible();
    await tableToggleBtn.click();

    // Verify structured accessible table columns appear
    await expect(page.locator('text=Structured Pipeline Dependency Table')).toBeVisible();
    await expect(page.locator('text=Upstream Dependencies')).toBeVisible();

    // Toggle back to Graph Canvas
    const graphToggleBtn = page.getByRole('button', { name: /Graph Canvas/i });
    await graphToggleBtn.click();
    await expect(page.locator('text=Structured Pipeline Dependency Table')).not.toBeVisible();
    await expect(page.locator('text=Pipeline DAG Lineage & Divergence Canvas')).toBeVisible();
  });

  test('exercises diff table filters and search input', async ({ page }) => {
    // Ensure diff table is visible
    await expect(page.getByRole('button', { name: /All Rows/i })).toBeVisible();

    // Check filter pills
    const allRowsPill = page.getByRole('button', { name: /All Rows/i });
    const modifiedPill = page.getByRole('button', { name: /Modified/i });

    await expect(allRowsPill).toBeVisible();
    await expect(modifiedPill).toBeVisible();

    // Click "Modified" filter
    await modifiedPill.click();

    // Search filter test
    const searchInput = page.getByPlaceholder(/Search rows/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('nonexistent_token_xyz');

    // Should show no rows matching
    await expect(page.locator('text=No rows match the current diff filter')).toBeVisible();

    // Clear search
    await searchInput.fill('');
  });
});

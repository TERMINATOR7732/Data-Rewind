import { test, expect } from '@playwright/test';

test.describe('Workspace Settings & Purge Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('inspects storage metrics and safely exercises application-managed purge', async ({ page }) => {
    await page.goto('/');

    // Navigate to Workspace tab
    await page.getByRole('button', { name: 'Workspace' }).click();
    await expect(page.locator('text=Workspace Storage & Data Privacy')).toBeVisible();

    // Check workspace metric cards
    await expect(page.locator('text=Total Workspace Disk')).toBeVisible();
    await expect(page.locator('text=Retained Files')).toBeVisible();
    await expect(page.locator('text=Local Storage Directory Root')).toBeVisible();

    // Verify confirmation modal before purge
    const deleteBtn = page.getByRole('button', { name: /Delete All Workspace Data/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Ensure confirmation prompt appears
    await expect(page.locator('text=Are you absolutely sure?')).toBeVisible();

    // Click confirm
    const confirmBtn = page.getByRole('button', { name: /Confirm Delete/i });
    await confirmBtn.click();

    // Verify success banner appears
    await expect(page.locator('text=Workspace storage purged successfully')).toBeVisible({ timeout: 10000 });
  });
});

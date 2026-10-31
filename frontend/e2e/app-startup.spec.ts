import { test, expect } from '@playwright/test';

test.describe('Application Startup & Shell Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('renders application shell, branding, and navigates across tabs', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // 1. Branding & Header verification
    await expect(page.getByText('DATA REWIND', { exact: true })).toBeVisible();
    await expect(page.locator('header').getByText('Understand the past. Verify the present.')).toBeVisible();
    await expect(page.locator('text=v0.1.0').first()).toBeVisible();

    // 2. Live backend connectivity status indicator
    await expect(page.locator('text=127.0.0.1:8000').first()).toBeVisible({ timeout: 10000 });

    // 3. Navigation tabs verification
    const tabs = [
      { name: 'Demo Sandbox', heading: 'In-Browser Data Pipeline Forensics & Reproducibility' },
      { name: 'CSV Ingestion', heading: 'Compare Two CSV Versions (Baseline vs Candidate)' },
      { name: 'Developer Mode', heading: 'Declarative Pipeline Manifest Workbench' },
      { name: 'Workspace', heading: 'Workspace Storage & Data Privacy' },
    ];

    for (const tab of tabs) {
      const tabButton = page.getByRole('button', { name: tab.name });
      await expect(tabButton).toBeVisible();
      await tabButton.click();
      await expect(page.getByText(tab.heading)).toBeVisible();
    }
  });

  test('displays disconnected state when backend is unreachable', async ({ page }) => {
    // Intercept health API route to simulate network failure
    await page.route('**/api/v1/health', (route) => route.abort());

    await page.goto('http://localhost:5173');

    // Backend status indicator should show disconnected state
    await expect(page.locator('text=Backend Disconnected').first()).toBeVisible({ timeout: 5000 });
  });
});

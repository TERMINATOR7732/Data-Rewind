import { test, expect } from '@playwright/test';

test.describe('Browser-Side Pipeline DAG Execution E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass onboarding tour for deterministic test execution
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('validates declarative DAG, plans topological stages, and executes in browser DuckDB-Wasm', async ({ page }) => {
    // Navigate to local application
    await page.goto('/');

    // Navigate to Developer Mode tab
    await page.getByRole('button', { name: 'Developer Mode' }).click();
    await expect(page.locator('text=Declarative Pipeline Manifest Workbench')).toBeVisible();

    // Verify Engine Switcher defaults to Browser Wasm
    const browserWasmBtn = page.getByRole('button', { name: /Browser Wasm/i });
    await expect(browserWasmBtn).toBeVisible();

    // Trigger DAG Validation
    const validateBtn = page.getByRole('button', { name: 'Validate DAG' });
    await expect(validateBtn).toBeVisible();
    await validateBtn.click();

    // Verify Topological Order & Deterministic Stages
    await expect(page.locator('text=Valid DAG!')).toBeVisible();
    await expect(page.locator('text=filter_active → derive_net → aggregate_metrics')).toBeVisible();
    await expect(page.getByText(/Stages:/)).toBeVisible();

    // Trigger Pipeline Execution in Browser Wasm Engine
    const executeBtn = page.getByRole('button', { name: /Execute Pipeline/i });
    await expect(executeBtn).toBeEnabled();
    await executeBtn.click();

    // Verify Execution Completion Banner
    await expect(page.locator('text=Execution COMPLETED')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('text=Checkpoints: 3')).toBeVisible();

    // Verify Intermediate Checkpoint & Hash Verification section
    await expect(page.locator('text=Intermediate Checkpoint & Hash Verification')).toBeVisible();

    // Verify all 3 steps show SUCCESS badges
    await expect(page.locator('span').filter({ hasText: /^filter_active$/ })).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^derive_net$/ })).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^aggregate_metrics$/ })).toBeVisible();

    // Verify multiset hash generation
    const multisetLabels = page.getByText(/Multiset:/);
    await expect(multisetLabels.first()).toBeVisible();

    // Click on aggregate_metrics step card to preview output
    const aggCard = page.locator('span').filter({ hasText: /^aggregate_metrics$/ });
    await aggCard.click();

    // Verify Preview Table renders aggregated metrics
    await expect(page.locator('text=Materialized Parquet/Wasm Preview: aggregate_metrics')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'total_net_revenue' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'event_count' })).toBeVisible();
  });
});

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

    // Verify Engine Switcher defaults to Browser (Recommended)
    const browserBtn = page.getByRole('button', { name: /Browser/i });
    await expect(browserBtn).toBeVisible();

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

  test('enforces hosted guardrail: restricts Python Backend and guides user when hosted demo profile is active', async ({ page }) => {
    // Intercept health check to simulate hosted_demo environment
    await page.route('**/api/v1/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          app_name: 'Data Rewind',
          version: '0.1.0',
          profile: 'hosted_demo',
          limits: {
            max_raw_csv_bytes: 10000000,
            max_dataset_rows: 50000,
            max_column_count: 50,
            max_cell_length_chars: 4096,
            max_line_length_bytes: 65536,
            max_process_rss_mib: 512,
            duckdb_max_memory_mib: 128,
            step_timeout_seconds: 30,
          },
          free_disk_mb: 25000,
          rss_mib: 85.5,
        }),
      });
    });

    let attemptedExecuteCall = false;
    await page.route('**/api/v1/pipelines/execute', async (route) => {
      attemptedExecuteCall = true;
      await route.abort();
    });

    await page.goto('/');

    // Navigate to Developer Mode
    await page.getByRole('button', { name: 'Developer Mode' }).click();
    await expect(page.locator('text=Declarative Pipeline Manifest Workbench')).toBeVisible();

    // Verify 'Local Only' tag is displayed inside Python Backend button in Developer Mode
    const backendBtn = page.getByRole('button', { name: /Python Backend/i });
    await expect(backendBtn).toBeVisible();
    await expect(backendBtn.locator('text=Local Only')).toBeVisible();

    // Click Python Backend
    await backendBtn.click();

    // Verify amber policy notice is rendered
    await expect(page.locator('text=Python Backend Notice')).toBeVisible();
    await expect(
      page.getByText(/Python Backend execution is available in local development/)
    ).toBeVisible();

    // Verify Execute Pipeline button is disabled
    const executeBtn = page.getByRole('button', { name: /Execute Pipeline/i });
    await expect(executeBtn).toBeDisabled();

    // Verify zero requests were sent to /api/v1/pipelines/execute
    expect(attemptedExecuteCall).toBe(false);

    // Click inline switch button in the notice banner
    const switchBtn = page.locator('button', { hasText: 'Browser (Recommended)' }).last();
    await switchBtn.click();

    // Notice should disappear and Execute button should be enabled
    await expect(page.locator('text=Python Backend Notice')).not.toBeVisible();
    await expect(executeBtn).toBeEnabled();
  });
});

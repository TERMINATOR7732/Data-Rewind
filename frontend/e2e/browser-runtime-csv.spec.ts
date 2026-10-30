import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Browser-First DuckDB-Wasm Runtime E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass onboarding tour for deterministic test execution
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('ingests CSV client-side with DuckDB-Wasm, inspects schema, and executes analytical SQL', async ({ page }) => {
    // Navigate to local application
    await page.goto('/');

    // Navigate to CSV Ingestion tab
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();
    await expect(page.locator('text=Ingest Raw CSV & Inspect Schemas')).toBeVisible();

    // Verify Engine Switcher defaults to Browser (Recommended)
    const browserBtn = page.getByRole('button', { name: /Browser/i });
    await expect(browserBtn).toBeVisible();
    await browserBtn.click();
    await expect(page.locator('text=Process CSV files directly in your browser')).toBeVisible();

    // Select valid CSV file
    const validCsvPath = path.resolve(__dirname, '../../tests/fixtures/e2e/valid_orders.csv');
    await page.setInputFiles('#csv-file-input', validCsvPath);

    // Verify file name display
    await expect(page.locator('text=valid_orders.csv')).toBeVisible();

    // Trigger Ingest & Validate
    const ingestBtn = page.getByRole('button', { name: /Ingest & Validate/i });
    await expect(ingestBtn).toBeEnabled();
    await ingestBtn.click();

    // Verify dataset ingestion success banner
    await expect(page.locator('text=Dataset Ingested: valid_orders.csv')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Rows Parsed')).toBeVisible();
    await expect(page.locator('text=Columns Inferred')).toBeVisible();
    await expect(page.locator('text=Preserved Size')).toBeVisible();

    // Verify DuckDB catalog inferred schema columns
    await expect(page.locator('text=order_id').first()).toBeVisible();
    await expect(page.locator('text=customer_id').first()).toBeVisible();
    await expect(page.locator('text=amount').first()).toBeVisible();
    await expect(page.locator('text=status').first()).toBeVisible();

    // Verify DuckDB sample preview table
    await expect(page.getByText(/First \d+ Rows Preview/)).toBeVisible();
    await expect(page.locator('text=CUST-001').first()).toBeVisible();

    // Execute analytical SQL transformation (filter predicate amount > 10.0)
    const runStepBtn = page.getByRole('button', { name: /Run Step/i });
    await expect(runStepBtn).toBeVisible();
    await runStepBtn.click();

    // Verify analytical SQL execution outcome banner
    await expect(page.locator('text=Execution: SUCCESS')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Result Rows:')).toBeVisible();

    // Switch to Raw SQL query mode
    const rawSqlToggle = page.getByRole('button', { name: /Switch to Raw SQL/i });
    if (await rawSqlToggle.isVisible()) {
      await rawSqlToggle.click();
      const runSqlBtn = page.getByRole('button', { name: /Run SQL/i });
      await expect(runSqlBtn).toBeVisible();
      await runSqlBtn.click();
      await expect(page.locator('text=Execution: SUCCESS')).toBeVisible({ timeout: 10000 });
    }
  });

  test('validates guardrails and rejects oversized cell in browser mode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();

    // Ensure Browser mode is active
    await page.getByRole('button', { name: /Browser/i }).click();

    const oversizedCsvPath = path.resolve(__dirname, '../../tests/fixtures/e2e/oversized_cell.csv');
    await page.setInputFiles('#csv-file-input', oversizedCsvPath);

    const ingestBtn = page.getByRole('button', { name: /Ingest & Validate/i });
    await ingestBtn.click();

    // Expect CELL_LENGTH_LIMIT_EXCEEDED error banner
    await expect(page.locator('text=CELL_LENGTH_LIMIT_EXCEEDED')).toBeVisible({ timeout: 10000 });
  });
});

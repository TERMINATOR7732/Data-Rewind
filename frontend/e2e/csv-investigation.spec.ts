import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('CSV Ingestion & Schema Inspector Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('uploads valid CSV fixture, verifies metadata and schema preview', async ({ page }) => {
    await page.goto('/');

    // Navigate to CSV Ingestion tab
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();
    await expect(page.locator('text=Ingest Raw CSV & Inspect Schemas')).toBeVisible();

    // Set file input to valid_orders.csv
    const validCsvPath = path.resolve(__dirname, '../../tests/fixtures/e2e/valid_orders.csv');
    await page.setInputFiles('#csv-file-input', validCsvPath);

    // Verify selected filename appears
    await expect(page.locator('text=valid_orders.csv')).toBeVisible();

    // Click "Ingest & Validate"
    const ingestBtn = page.getByRole('button', { name: /Ingest & Validate/i });
    await expect(ingestBtn).toBeEnabled();
    await ingestBtn.click();

    // Verify upload success banner & metadata
    await expect(page.locator('text=Dataset Ingested: valid_orders.csv')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Rows Parsed')).toBeVisible();
    await expect(page.locator('text=Columns Inferred')).toBeVisible();

    // Verify schema columns grid
    await expect(page.locator('text=order_id').first()).toBeVisible();
    await expect(page.locator('text=customer_id').first()).toBeVisible();
    await expect(page.locator('text=amount').first()).toBeVisible();
    await expect(page.locator('text=status').first()).toBeVisible();

    // Verify DuckDB 50-row sample preview table
    await expect(page.locator('text=First 50 Rows Preview')).toBeVisible();
    await expect(page.locator('text=CUST-001').first()).toBeVisible();
  });

  test('rejects CSV with oversized cell (> 4,096 chars) with appropriate error', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();

    const oversizedCsvPath = path.resolve(__dirname, '../../tests/fixtures/e2e/oversized_cell.csv');
    await page.setInputFiles('#csv-file-input', oversizedCsvPath);

    const ingestBtn = page.getByRole('button', { name: /Ingest & Validate/i });
    await ingestBtn.click();

    // Expect error alert with CELL_LENGTH_LIMIT_EXCEEDED
    await expect(page.locator('text=CELL_LENGTH_LIMIT_EXCEEDED')).toBeVisible({ timeout: 10000 });
  });
});

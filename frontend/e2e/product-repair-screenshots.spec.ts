import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const screenshotDir = path.resolve(
  'C:/Users/Admin/.gemini/antigravity/brain/a2a56324-be12-4e90-83b6-37286d8fc529/screenshots/product_repair_overhaul'
);

const ordersCsv = path.resolve(__dirname, '../../tests/fixtures/e2e/test_orders_a.csv');
const ordersDriftCsv = path.resolve(__dirname, '../../tests/fixtures/e2e/test_orders_drift_modified.csv');

test.describe('Product Repair & UX Overhaul Visual Artifact Capture', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('captures complete visual evidence suite for all overhaul phases', async ({ page }) => {
    // 1. Landing Page Identity & Entry Points
    await page.goto('/');
    await expect(page.locator('text=DATA REWIND • Understand the past. Verify the present.')).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, '01_landing_page_identity.png'),
      fullPage: true,
    });

    // 2. Investigation Empty State (Mock Probe Eliminated)
    await page.getByRole('button', { name: 'Investigation', exact: true }).click();
    await expect(page.locator('text=No Active Investigation')).toBeVisible();
    await expect(page.getByTestId('run-browser-probe')).not.toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, '02_investigation_empty_state_clean.png'),
      fullPage: true,
    });

    // 3. Two-File Comparison Ingestion
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();
    await page.setInputFiles('#csv-file-input', ordersCsv);
    await page.getByRole('button', { name: /Ingest & Validate/i }).click();
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });

    await page.setInputFiles('#candidate-file-input', ordersDriftCsv);
    await expect(page.locator('text=Candidate Ingested: test_orders_drift_modified.csv')).toBeVisible({ timeout: 15000 });

    await page.screenshot({
      path: path.join(screenshotDir, '03_csv_two_file_comparison.png'),
      fullPage: true,
    });

    // 4. Investigation View: Differences Detected & 5 Questions
    const compareBtn = page.getByTestId('compare-csv-datasets-btn');
    await compareBtn.click();
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
    const evidencePanel = page.locator('[data-tour="evidence-panel"]');
    await expect(evidencePanel.locator('text=1. What Went Wrong?')).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, '04_investigation_divergence_five_questions.png'),
      fullPage: true,
    });

    // 5. Clean Equivalence (Zero Divergence)
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();
    await page.setInputFiles('#candidate-file-input', ordersCsv);
    await expect(page.locator('text=Candidate Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('compare-csv-datasets-btn').click();
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
    await expect(evidencePanel.locator('text=Pipeline Equivalence Verified — No Differences Detected')).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, '05_investigation_verified_equivalent.png'),
      fullPage: true,
    });

    // 6. Mode 2: Pipeline Builder & 10 Transformations
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();
    await page.getByTestId('tab-pipeline-builder').click();
    await expect(page.getByRole('heading', { name: /Pipeline Transformation DAG Builder/i })).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, '06_csv_pipeline_builder.png'),
      fullPage: true,
    });
  });
});

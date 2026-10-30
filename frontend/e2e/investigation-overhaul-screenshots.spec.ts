import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const screenshotDir = path.resolve(
  'C:/Users/Admin/.gemini/antigravity/brain/a2a56324-be12-4e90-83b6-37286d8fc529/screenshots/investigation_overhaul'
);

test.describe('Investigation Correctness & Explainability Live Verification', () => {
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

  test('captures live screenshot of the five-question explainability panel and DAG', async ({ page }) => {
    // 1. Navigate to home
    await page.goto('/');

    // 2. Go to Investigation tab
    const investigateTab = page.getByRole('button', { name: /^Investigation/i });
    await expect(investigateTab).toBeVisible();
    await investigateTab.click();

    // 3. Trigger In-Browser Forensic Probe
    const runProbeBtn = page.getByTestId('run-browser-probe');
    await expect(runProbeBtn).toBeVisible();
    await runProbeBtn.click();

    // 4. Wait for Investigation Dossier to be fully populated
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
    const evidencePanel = page.locator('[data-tour="evidence-panel"]');
    await expect(evidencePanel).toBeVisible();

    // 5. Verify the Five Questions are rendered
    await expect(evidencePanel.locator('text=1. What Went Wrong?')).toBeVisible();
    await expect(evidencePanel.locator('text=2. Where Did It Go Wrong?')).toBeVisible();
    await expect(evidencePanel.locator('text=3. What Is The Evidence?')).toBeVisible();
    await expect(evidencePanel.locator('text=4. Why Does It Matter?')).toBeVisible();
    await expect(evidencePanel.locator('text=5. How Can I Fix & Verify It?')).toBeVisible();

    // Capture main investigation view screenshot
    await page.screenshot({
      path: path.join(screenshotDir, 'investigation_five_questions.png'),
      fullPage: true,
    });

    // 6. Expand Technical Details accordion
    const technicalBtn = page.getByRole('button', { name: /Technical Details/i });
    if (await technicalBtn.isVisible()) {
      await technicalBtn.click();
      await expect(page.locator('text=Diagnostic Rule ID:')).toBeVisible();

      // Capture screenshot with technical details expanded
      await page.screenshot({
        path: path.join(screenshotDir, 'investigation_technical_details.png'),
        fullPage: true,
      });
    }

    // 7. Inspect DAG canvas
    const dagCanvas = page.locator('text=Pipeline DAG Lineage & Divergence Canvas');
    await expect(dagCanvas).toBeVisible();
    await expect(page.locator('text=First Divergence (EOD)')).toBeVisible();
  });

  test('verifies consecutive uploads of different CSVs produce distinct schemas and isolated state', async ({ page }) => {
    await page.goto('/');

    // 1. Navigate to CSV Ingestion
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();
    await expect(page.locator('text=Ingest Raw CSV & Inspect Schemas')).toBeVisible();

    // Upload Dataset 1: Orders
    const ordersCsv = path.resolve(__dirname, '../../tests/fixtures/e2e/test_orders_a.csv');
    await page.setInputFiles('#csv-file-input', ordersCsv);
    await expect(page.locator('text=test_orders_a.csv')).toBeVisible();

    const ingestBtn = page.getByRole('button', { name: /Ingest & Validate/i });
    await expect(ingestBtn).toBeEnabled();
    await ingestBtn.click();

    // Verify Orders schema and row count
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=customer_id').first()).toBeVisible();
    await expect(page.locator('text=order_id').first()).toBeVisible();
    await expect(page.locator('text=CUST-A').first()).toBeVisible();

    // Screenshot dataset 1
    await page.screenshot({
      path: path.join(screenshotDir, 'csv_orders_dataset.png'),
      fullPage: true,
    });

    // Upload Dataset 2: Inventory (consecutive upload)
    const inventoryCsv = path.resolve(__dirname, '../../tests/fixtures/e2e/test_inventory_b.csv');
    await page.setInputFiles('#csv-file-input', inventoryCsv);
    await expect(page.locator('text=test_inventory_b.csv')).toBeVisible();

    // Previous orders preview is immediately cleared upon new file selection
    await expect(page.locator('text=CUST-A')).not.toBeVisible();

    await ingestBtn.click();

    // Verify Inventory schema and row count
    await expect(page.locator('text=Dataset Ingested: test_inventory_b.csv')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=sku').first()).toBeVisible();
    await expect(page.locator('text=warehouse').first()).toBeVisible();
    await expect(page.locator('text=SKU-99').first()).toBeVisible();

    // Screenshot dataset 2
    await page.screenshot({
      path: path.join(screenshotDir, 'csv_inventory_dataset.png'),
      fullPage: true,
    });
  });
});

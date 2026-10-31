import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ordersCsv = path.resolve(__dirname, '../../tests/fixtures/e2e/test_orders_a.csv');
const ordersDriftCsv = path.resolve(__dirname, '../../tests/fixtures/e2e/test_orders_drift_modified.csv');
const inventoryCsv = path.resolve(__dirname, '../../tests/fixtures/e2e/test_inventory_b.csv');

test.describe('Data Rewind Comprehensive Product Overhaul & User Journeys E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass onboarding tour for deterministic test execution
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  // -------------------------------------------------------------------------
  // Journey 1: Two-File Comparison — Divergence Detected
  // -------------------------------------------------------------------------
  test('Journey 1: compares two distinct CSV files, isolates dataset-level divergence and displays 5 core questions', async ({ page }) => {
    await page.goto('/');

    // Navigate to CSV Ingestion
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();
    await expect(page.locator('text=Compare Two CSV Versions (Baseline vs Candidate)')).toBeVisible();

    // Ingest Baseline (R0)
    await page.setInputFiles('#csv-file-input', ordersCsv);
    const ingestBaselineBtn = page.getByRole('button', { name: /Ingest & Validate/i });
    await expect(ingestBaselineBtn).toBeEnabled();
    await ingestBaselineBtn.click();

    // Verify Baseline metadata card
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=order_id').first()).toBeVisible();
    await expect(page.locator('text=CUST-A').first()).toBeVisible();

    // Ingest Candidate (R1)
    await page.setInputFiles('#candidate-file-input', ordersDriftCsv);
    await expect(page.locator('text=Candidate Ingested: test_orders_drift_modified.csv')).toBeVisible({ timeout: 15000 });

    // Verify comparison key detected and trigger comparison
    const compareBtn = page.getByTestId('compare-csv-datasets-btn');
    await expect(compareBtn).toBeVisible();
    await compareBtn.click();

    // Automatically transitions to Investigation view
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('test_orders_a.csv vs test_orders_drift_modified.csv');

    // EOD Card
    const eodCard = page.locator('[data-tour="eod-card"]');
    await expect(eodCard).toBeVisible();
    await expect(eodCard.locator('text=csv_dataset')).toBeVisible();

    // Evidence Panel — Differences Detected State
    const evidencePanel = page.locator('[data-tour="evidence-panel"]');
    await expect(evidencePanel).toBeVisible();
    await expect(evidencePanel.locator('text=Forensic Evidence & Root Cause Analysis')).toBeVisible();
    await expect(evidencePanel.locator('text=1. What Went Wrong?')).toBeVisible();
    await expect(evidencePanel.locator('text=2. Where Did It Go Wrong?')).toBeVisible();
    await expect(evidencePanel.locator('text=3. What Is The Evidence?')).toBeVisible();
    await expect(evidencePanel.locator('text=4. Why Does It Matter?')).toBeVisible();
    await expect(evidencePanel.locator('text=5. How Can I Fix & Verify It?')).toBeVisible();

    // Diff Table contains cell differences
    await expect(page.locator('table').getByText('MODIFIED').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Journey 2: Two-File Comparison — Clean Equivalence (Zero Divergence)
  // -------------------------------------------------------------------------
  test('Journey 2: compares identical CSV files, displays positive emerald equivalence with 0 modified rows', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'CSV Ingestion' }).click();

    // Ingest Baseline (R0)
    await page.setInputFiles('#csv-file-input', ordersCsv);
    await page.getByRole('button', { name: /Ingest & Validate/i }).click();
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });

    // Ingest EXACT same file as Candidate (R1)
    await page.setInputFiles('#candidate-file-input', ordersCsv);
    await expect(page.locator('text=Candidate Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });

    // Compare
    const compareBtn = page.getByTestId('compare-csv-datasets-btn');
    await compareBtn.click();

    // Transitions to Investigation view
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });

    // EOD Card indicates zero divergence
    const eodCard = page.locator('[data-tour="eod-card"]');
    await expect(eodCard).toBeVisible();
    await expect(eodCard.getByText(/Zero Divergence/i)).toBeVisible();

    // Evidence Panel — Verified Equivalent State
    const evidencePanel = page.locator('[data-tour="evidence-panel"]');
    await expect(evidencePanel).toBeVisible();
    await expect(evidencePanel.locator('text=Pipeline Equivalence Verified — No Differences Detected')).toBeVisible();
    await expect(evidencePanel.getByText(/0 modified rows/i)).toBeVisible();
    await expect(evidencePanel.getByText(/0 Sinks Tainted/i)).toBeVisible();
    await expect(evidencePanel.locator('text=Zero Divergence')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Journey 3: Independent File Replacement
  // -------------------------------------------------------------------------
  test('Journey 3: replacing one slot preserves the other slot without data loss', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'CSV Ingestion' }).click();

    // Load Baseline
    await page.setInputFiles('#csv-file-input', ordersCsv);
    await page.getByRole('button', { name: /Ingest & Validate/i }).click();
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });

    // Load Candidate
    await page.setInputFiles('#candidate-file-input', inventoryCsv);
    await expect(page.locator('text=Candidate Ingested: test_inventory_b.csv')).toBeVisible({ timeout: 15000 });

    // Replace Candidate only
    const replaceCandidateBtn = page.getByTestId('replace-candidate-btn');
    await expect(replaceCandidateBtn).toBeVisible();
    await replaceCandidateBtn.click();

    // Baseline is STILL intact
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible();
    await expect(page.locator('text=CUST-A').first()).toBeVisible();

    // Candidate dropzone is reset
    await expect(page.locator('text=Select or Drop Candidate CSV (R₁)')).toBeVisible();

    // Ingest new Candidate
    await page.setInputFiles('#candidate-file-input', ordersDriftCsv);
    await expect(page.locator('text=Candidate Ingested: test_orders_drift_modified.csv')).toBeVisible({ timeout: 15000 });

    // Replace Baseline only
    const replaceBaselineBtn = page.getByTestId('replace-baseline-btn');
    await expect(replaceBaselineBtn).toBeVisible();
    await replaceBaselineBtn.click();

    // Candidate is STILL intact
    await expect(page.locator('text=Candidate Ingested: test_orders_drift_modified.csv')).toBeVisible();

    // Baseline dropzone is reset
    await expect(page.locator('text=Select or Drop Baseline CSV (R₀)')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Journey 4: Workspace State Retention Across Navigation Tabs
  // -------------------------------------------------------------------------
  test('Journey 4: persists ingested datasets and pipeline state across tab navigation', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'CSV Ingestion' }).click();

    // Ingest Baseline
    await page.setInputFiles('#csv-file-input', ordersCsv);
    await page.getByRole('button', { name: /Ingest & Validate/i }).click();
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });

    // Navigate to other tabs
    await page.getByRole('button', { name: 'Investigation' }).click();
    await expect(page.locator('text=No Active Investigation')).toBeVisible();

    await page.getByRole('button', { name: 'Fix Verification' }).click();
    await page.getByRole('button', { name: 'Developer Mode' }).click();

    // Navigate back to CSV Ingestion
    await page.getByRole('button', { name: 'CSV Ingestion' }).click();

    // Ingested dataset state is STILL preserved without reload
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible();
    await expect(page.locator('text=CUST-A').first()).toBeVisible();
    await expect(page.locator('text=150').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Journey 5: Zero Mock Probes in Empty State
  // -------------------------------------------------------------------------
  test('Journey 5: empty investigation view contains no synthetic mock probes and offers clean navigation', async ({ page }) => {
    await page.goto('/');

    // Directly open Investigation tab without prior run
    await page.getByRole('button', { name: 'Investigation' }).click();

    // Verify empty state is displayed
    await expect(page.locator('text=No Active Investigation')).toBeVisible();

    // Assert that the removed synthetic mock probe button is NOT present
    await expect(page.getByTestId('run-browser-probe')).not.toBeVisible();

    // Verify clear navigational entry points
    const navCsvBtn = page.getByTestId('nav-csv-compare');
    const navDemoBtn = page.getByTestId('nav-demo-scenarios');
    await expect(navCsvBtn).toBeVisible();
    await expect(navDemoBtn).toBeVisible();

    // Clicking "Compare Two CSV Files" routes to CSV Ingestion
    await navCsvBtn.click();
    await expect(page.locator('text=Compare Two CSV Versions (Baseline vs Candidate)')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Journey 6: Landing Page Onboarding, Brand Identity & Entry Points
  // -------------------------------------------------------------------------
  test('Journey 6: landing page communicates brand identity, trust guarantees, and 3 clear entry cards', async ({ page }) => {
    await page.goto('/');

    // Brand Tagline & Headline
    await expect(page.locator('text=DATA REWIND • Understand the past. Verify the present.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /In-Browser Data Pipeline Forensics & Reproducibility/i })).toBeVisible();

    // Trust Guarantee Banner
    await expect(page.getByText(/100% In-Browser DuckDB-Wasm Execution/i)).toBeVisible();
    await expect(page.getByText(/Strict ₹0 Operation/i)).toBeVisible();

    // 3 Starting Point Cards
    await expect(page.getByRole('heading', { name: 'Compare Two CSV Versions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Build & Investigate Pipeline' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Explore Interactive Demos' })).toBeVisible();

    // CTA Button navigates to CSV
    const compareCardBtn = page.getByRole('button', { name: 'Compare CSV Files' });
    await expect(compareCardBtn).toBeVisible();
    await compareCardBtn.click();
    await expect(page.locator('text=Compare Two CSV Versions (Baseline vs Candidate)')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Journey 7: Single CSV & Pipeline Builder Workflow
  // -------------------------------------------------------------------------
  test('Journey 7: builds in-browser transformation pipeline, executes baseline R0, candidate R1, and triggers comparative investigation', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'CSV Ingestion' }).click();

    // Switch to Mode 2: Single CSV & Pipeline Builder
    const pipelineBuilderTab = page.getByTestId('tab-pipeline-builder');
    await expect(pipelineBuilderTab).toBeVisible();
    await pipelineBuilderTab.click();

    await expect(page.locator('text=Single CSV & Pipeline Builder (10 Transformations)')).toBeVisible();

    // Ingest Single CSV
    await page.setInputFiles('#single-csv-file-input', ordersCsv);
    await page.getByRole('button', { name: /Ingest & Validate/i }).click();
    await expect(page.locator('text=Dataset Ingested: test_orders_a.csv')).toBeVisible({ timeout: 15000 });

    // Pipeline DAG builder is displayed
    await expect(page.getByRole('heading', { name: /Pipeline Transformation DAG Builder/i })).toBeVisible();

    // Execute Baseline Run (R0)
    const execBaselineBtn = page.getByTestId('execute-baseline-run-btn');
    await expect(execBaselineBtn).toBeVisible();
    await execBaselineBtn.click();

    // Verify baseline execution success
    await expect(page.getByText(/Baseline R₀ ready/i)).toBeVisible({ timeout: 15000 });

    // Execute Candidate Run (R1) & Compare
    const execCandidateBtn = page.getByTestId('execute-candidate-run-btn');
    await expect(execCandidateBtn).toBeVisible();
    await execCandidateBtn.click();

    // Automatically transitions to Investigation view
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
  });
});

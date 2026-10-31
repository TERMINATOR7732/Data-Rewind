import { test, expect } from '@playwright/test';

test.describe('Browser Forensic Investigation Engine E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass onboarding tour for deterministic test execution
    await page.addInitScript(() => {
      localStorage.setItem('data_rewind_tour_completed', 'true');
    });
  });

  test('executes in-browser forensic probe, isolates EOD node, and inspects cell-level diffs', async ({ page }) => {
    // 1. Navigate to application
    await page.goto('/');

    // 2. Switch to Investigation tab to verify empty state without mock probes
    const investigateTab = page.getByRole('button', { name: /^Investigation/i });
    await expect(investigateTab).toBeVisible();
    await investigateTab.click();

    // 3. Verify Empty State and absence of hardcoded mock probe button
    await expect(page.locator('text=No Active Investigation')).toBeVisible();
    await expect(page.getByTestId('run-browser-probe')).not.toBeVisible();
    const navDemoBtn = page.getByTestId('nav-demo-scenarios');
    await expect(navDemoBtn).toBeVisible();

    // 4. Navigate to Demo Scenarios and run canonical SCN-01 investigation
    await navDemoBtn.click();
    await expect(page.locator('text=Select Pipeline Scenario')).toBeVisible();

    const runInvestigationBtn = page.getByRole('button', { name: /Run investigation/i });
    await expect(runInvestigationBtn).toBeVisible();
    await runInvestigationBtn.click();

    // 5. Verify Investigation Dossier loaded
    await expect(page.locator('text=Forensic Investigation Dossier')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('SCN-01');

    // 6. Verify Earliest Observable Divergence (EOD) Card
    const eodCard = page.locator('[data-tour="eod-card"]');
    await expect(eodCard).toBeVisible();
    await expect(eodCard.locator('text=ingest_orders')).toBeVisible();

    // 7. Verify Forensic Evidence & Root Cause Panel
    const evidencePanel = page.locator('[data-tour="evidence-panel"]');
    await expect(evidencePanel).toBeVisible();
    await expect(evidencePanel.locator('text=Forensic Evidence & Root Cause Analysis')).toBeVisible();
    await expect(evidencePanel.locator('text=4. Why Does It Matter?')).toBeVisible();
    await expect(evidencePanel.getByText(/Graph Taint:/i)).toBeVisible();

    // 8. Verify Cell-Level Diff Table & Filter Pills
    await expect(page.getByRole('button', { name: /All Rows/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Modified/i })).toBeVisible();

    // Verify modified row indicators exist in diff table
    await expect(page.getByText('MODIFIED').first()).toBeVisible();

    // 9. Test Diff Table Filtering
    const modifiedPill = page.getByRole('button', { name: /Modified/i });
    await modifiedPill.click();
    await expect(page.getByText('NORTH').first()).toBeVisible();

    // 10. Toggle Accessible Table View for Lineage DAG
    const accessibleTableBtn = page.getByRole('button', { name: /Accessible Table/i });
    if (await accessibleTableBtn.isVisible()) {
      await accessibleTableBtn.click();
      await expect(page.locator('text=Structured Pipeline Dependency Table')).toBeVisible();

      const graphCanvasBtn = page.getByRole('button', { name: /Graph Canvas/i });
      await graphCanvasBtn.click();
      await expect(page.locator('text=Pipeline DAG Lineage & Divergence Canvas')).toBeVisible();
    }
  });
});

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

test.describe('MS5.0 Production Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);

    // Mock authentication
    await page.evaluate(() => {
      localStorage.setItem('auth_token', 'test-token');
      localStorage.setItem('user_role', 'supervisor');
    });
  });

  test('Complete production workflow', async ({ page }) => {
    // 1. Login and navigate to dashboard
    await page.goto(`${BASE_URL}/login`);
    await page.fill('[name="email"]', 'supervisor@ms5.example.com');
    await page.fill('[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);

    // 2. Check production line status
    const lineCard = page.locator('[data-testid="line-1-card"]');
    await expect(lineCard).toBeVisible();
    await expect(lineCard.locator('.status')).toContainText('Running');

    // 3. Navigate to SQDC board
    await page.click('[data-testid="nav-sqdc"]');
    await expect(page).toHaveURL(`${BASE_URL}/sqdc`);

    // 4. Create a new action
    await page.click('[data-testid="create-action-btn"]');

    const modal = page.locator('[data-testid="action-modal"]');
    await expect(modal).toBeVisible();

    await page.selectOption('[name="boardType"]', 'SQDC');
    await page.selectOption('[name="category"]', 'QUALITY');
    await page.fill('[name="description"]', 'E2E test: Quality issue on Line 1');
    await page.selectOption('[name="assignedTo"]', 'operator-1');
    await page.fill('[name="dueDate"]', '2025-01-20');

    await page.click('[data-testid="submit-action"]');
    await expect(modal).not.toBeVisible();

    // 5. Verify action appears in list
    const actionList = page.locator('[data-testid="actions-list"]');
    await expect(actionList).toContainText('E2E test: Quality issue on Line 1');

    // 6. Navigate to Loss Analytics
    await page.click('[data-testid="nav-analytics"]');
    await expect(page).toHaveURL(`${BASE_URL}/analytics`);

    // 7. Check OEE metrics
    const oeeCard = page.locator('[data-testid="oee-summary"]');
    await expect(oeeCard).toBeVisible();
    await expect(oeeCard.locator('[data-testid="oee-value"]')).toBeVisible();

    // 8. Test real-time updates via WebSocket
    await page.goto(`${BASE_URL}/realtime`);

    const eventLog = page.locator('[data-testid="event-log"]');
    await expect(eventLog).toBeVisible();

    // Simulate Andon trigger from another source
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('andon-triggered', {
        detail: { lineId: 'line-1', type: 'QUALITY' }
      }));
    });

    await expect(eventLog).toContainText('Andon Triggered: QUALITY on line-1');

    // 9. Test data filtering and search
    await page.goto(`${BASE_URL}/production-history`);

    await page.fill('[data-testid="date-from"]', '2025-01-01');
    await page.fill('[data-testid="date-to"]', '2025-01-15');
    await page.selectOption('[data-testid="line-filter"]', 'line-1');
    await page.click('[data-testid="apply-filters"]');

    const results = page.locator('[data-testid="history-results"]');
    await expect(results).toBeVisible();

    // 10. Export data
    await page.click('[data-testid="export-btn"]');
    await page.selectOption('[data-testid="export-format"]', 'csv');

    const download = await page.waitForEvent('download');
    expect(download.suggestedFilename()).toContain('production-data');
  });

  test('Mobile Andon workflow', async ({ page, context }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    // 1. Navigate to Andon screen
    await page.goto(`${BASE_URL}/mobile/andon`);

    // 2. Select station
    await page.selectOption('[data-testid="line-select"]', 'Line 1');
    await page.selectOption('[data-testid="station-select"]', 'Station 3');

    // 3. Trigger quality Andon
    const qualityButton = page.locator('[data-testid="andon-quality"]');
    await expect(qualityButton).toBeEnabled();
    await qualityButton.click();

    // 4. Confirm in dialog
    const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(confirmDialog).toBeVisible();
    await page.click('[data-testid="confirm-yes"]');

    // 5. Verify active call display
    const activeCall = page.locator('[data-testid="active-call"]');
    await expect(activeCall).toBeVisible();
    await expect(activeCall).toContainText('QUALITY');

    // 6. Wait and cancel call
    await page.waitForTimeout(3000); // Simulate response time
    await page.click('[data-testid="cancel-call"]');

    await expect(activeCall).not.toBeVisible();
  });

  test('Supervisor dashboard monitoring', async ({ page }) => {
    await page.goto(`${BASE_URL}/supervisor`);

    // 1. Check all production lines overview
    const linesGrid = page.locator('[data-testid="lines-grid"]');
    await expect(linesGrid.locator('.line-card')).toHaveCount(3);

    // 2. Verify real-time KPI updates
    const kpiPanel = page.locator('[data-testid="kpi-panel"]');

    const initialOEE = await kpiPanel.locator('[data-testid="overall-oee"]').textContent();

    // Wait for update
    await page.waitForTimeout(5000);

    const updatedOEE = await kpiPanel.locator('[data-testid="overall-oee"]').textContent();
    expect(updatedOEE).toBeDefined();

    // 3. Test alert notifications
    const alertsBadge = page.locator('[data-testid="alerts-badge"]');
    const alertsCount = await alertsBadge.textContent();

    if (alertsCount && parseInt(alertsCount) > 0) {
      await page.click('[data-testid="alerts-icon"]');

      const alertsPanel = page.locator('[data-testid="alerts-panel"]');
      await expect(alertsPanel).toBeVisible();
      await expect(alertsPanel.locator('.alert-item')).toHaveCount(parseInt(alertsCount));
    }

    // 4. Navigate to specific line details
    await page.click('[data-testid="line-1-details"]');
    await expect(page).toHaveURL(`${BASE_URL}/lines/line-1`);

    // 5. Check line-specific metrics
    const lineMetrics = page.locator('[data-testid="line-metrics"]');
    await expect(lineMetrics).toBeVisible();
    await expect(lineMetrics.locator('[data-testid="availability"]')).toBeVisible();
    await expect(lineMetrics.locator('[data-testid="performance"]')).toBeVisible();
    await expect(lineMetrics.locator('[data-testid="quality"]')).toBeVisible();
  });

  test('Data persistence and recovery', async ({ page, context }) => {
    // 1. Create data while online
    await page.goto(`${BASE_URL}/sqdc`);

    await page.click('[data-testid="create-action-btn"]');
    await page.fill('[name="description"]', 'Offline test action');
    await page.click('[data-testid="submit-action"]');

    // 2. Go offline
    await context.setOffline(true);

    // 3. Try to create action while offline
    await page.click('[data-testid="create-action-btn"]');
    await page.fill('[name="description"]', 'Created while offline');
    await page.click('[data-testid="submit-action"]');

    // Should show offline indicator
    await expect(page.locator('[data-testid="offline-indicator"]')).toBeVisible();

    // 4. Go back online
    await context.setOffline(false);

    // 5. Verify sync occurred
    await page.reload();

    const actionsList = page.locator('[data-testid="actions-list"]');
    await expect(actionsList).toContainText('Created while offline');
  });

  test('Security and permissions', async ({ page }) => {
    // 1. Test operator permissions
    await page.evaluate(() => {
      localStorage.setItem('user_role', 'operator');
    });

    await page.goto(`${BASE_URL}/admin`);
    await expect(page).toHaveURL(`${BASE_URL}/unauthorized`);

    // 2. Test manager permissions
    await page.evaluate(() => {
      localStorage.setItem('user_role', 'manager');
    });

    await page.goto(`${BASE_URL}/admin`);
    await expect(page).toHaveURL(`${BASE_URL}/admin`);

    // 3. Test CSRF protection
    const response = await page.request.post(`${BASE_URL}/api/actions`, {
      data: { test: 'data' },
      headers: {
        'Content-Type': 'application/json'
        // Missing CSRF token
      }
    });

    expect(response.status()).toBe(403);
  });
});
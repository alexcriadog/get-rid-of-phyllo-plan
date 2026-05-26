import { test, expect } from '@playwright/test';

// Verifies the SDK launches an in-page iframe modal (NOT a new tab).
// Runs against the connect-ui dev server on :3002 (must be running).
test('SDK opens an in-page modal, not a new tab', async ({ page, context }) => {
  // Navigate to the same origin as the SDK so postMessage and iframe load work
  // without cross-origin restrictions.
  await page.goto('http://localhost:3002/');

  // Inject the SDK bundle (IIFE assigns window.__CamaleonicConnectBundle;
  // the bundle footer also sets window.CamaleonicConnect = bundle.default).
  await page.addScriptTag({ url: 'http://localhost:3002/connect-sdk.js' });

  const pagesBefore = context.pages().length;

  await page.evaluate(() => {
    // The IIFE footer sets window.CamaleonicConnect = __CamaleonicConnectBundle.default,
    // so both paths below resolve to the same { init, version } object.
    const api =
      (window as any).CamaleonicConnect ??
      (window as any).__CamaleonicConnectBundle?.default;
    const handle = api.init({
      baseUrl: 'http://localhost:3002',
      sdkToken: 'e2e',
      workspace: 'demo',
    });
    handle.open('tiktok');
  });

  const overlay = page.locator('[data-camaleonic-overlay]');
  await expect(overlay).toBeVisible();

  const iframe = page.locator('[data-camaleonic-modal] iframe');
  const src = await iframe.getAttribute('src');
  expect(src).toContain('http://localhost:3002/connect?');
  expect(src).toContain('embed=1');
  expect(src).toContain('platform=tiktok');

  // No new tab/window was opened.
  expect(context.pages().length).toBe(pagesBefore);
});

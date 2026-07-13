import { test, expect } from '@playwright/test';

// When an embedded OAuth flow fails (user denies the consent screen), the
// callback 302s the provider-login popup to /oauth/complete?error=… instead
// of the connector root. The relay must post `camaleonic.oauth.error` back
// to its opener (the iframe shell) and close itself, so the user never
// leaves the client's page. Runs against the connect-ui server on :3002.
test('oauth error relay posts the error to the opener and closes the popup', async ({ page }) => {
  await page.goto('http://localhost:3002/oauth/complete');

  const relayed = await page.evaluate(
    () =>
      new Promise<{ type: string; platform: string; message: string }>((resolve, reject) => {
        window.addEventListener('message', (ev) => {
          if (ev.data?.type === 'camaleonic.oauth.error') resolve(ev.data);
        });
        const url =
          '/oauth/complete?platform=threads&error=' +
          encodeURIComponent('threads denied: access_denied — Permissions error');
        const popup = window.open(url, 'camaleonic-oauth-e2e', 'popup=yes');
        if (!popup) reject(new Error('popup blocked'));
        setTimeout(() => reject(new Error('no camaleonic.oauth.error received')), 10_000);
      }),
  );

  expect(relayed.platform).toBe('threads');
  expect(relayed.message).toBe('threads denied: access_denied — Permissions error');

  // The relay closes itself shortly after posting.
  await expect
    .poll(() => page.context().pages().length, { timeout: 5_000 })
    .toBe(1);
});

// The success shape must keep working: ?session=… still posts
// `camaleonic.oauth.complete` with the session id.
test('oauth success relay still posts the session to the opener', async ({ page }) => {
  await page.goto('http://localhost:3002/oauth/complete');

  const relayed = await page.evaluate(
    () =>
      new Promise<{ type: string; sessionId: string; kind: string; platform: string }>(
        (resolve, reject) => {
          window.addEventListener('message', (ev) => {
            if (ev.data?.type === 'camaleonic.oauth.complete') resolve(ev.data);
          });
          const popup = window.open(
            '/oauth/complete?session=abc123&kind=confirm&platform=threads',
            'camaleonic-oauth-e2e-ok',
            'popup=yes',
          );
          if (!popup) reject(new Error('popup blocked'));
          setTimeout(() => reject(new Error('no camaleonic.oauth.complete received')), 10_000);
        },
      ),
  );

  expect(relayed.sessionId).toBe('abc123');
  expect(relayed.kind).toBe('confirm');
  expect(relayed.platform).toBe('threads');
});

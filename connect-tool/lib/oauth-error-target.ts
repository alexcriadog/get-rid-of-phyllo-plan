/**
 * Where to send the browser when an OAuth flow fails (provider denial,
 * state-verification failure, token-exchange error, …).
 *
 * Standalone flows live on the connector's own pages, so the root page —
 * which renders the friendly error banner — is home. Embedded (SDK modal)
 * flows run in a provider-login popup whose opener is the iframe shell on
 * the client's site: parking that popup on the connector root strands the
 * user outside the client's UI. Those flows route through the
 * /oauth/complete relay, which posts the error back to the modal and
 * closes the popup — mirroring what the success path already does.
 */
export function oauthErrorTarget(
  baseUrl: string,
  platform: string,
  message: string,
  embedded: boolean,
): string {
  if (embedded) {
    const qs = new URLSearchParams({ platform, error: message });
    return `${baseUrl}/oauth/complete?${qs.toString()}`;
  }
  return `${baseUrl}/?error=${encodeURIComponent(message)}`;
}

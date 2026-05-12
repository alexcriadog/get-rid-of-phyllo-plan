// Terms of service. Technical draft — legal team should review before
// submitting to Google OAuth verification.

import Link from 'next/link';

const LAST_UPDATED = '2026-05-11';

export default function Terms() {
  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <span className="v-kicker red">camaleonic analytics</span>
          <span className="v-eyebrow">Terms of service</span>
        </header>

        <div className="v-legal-prose">
          <h1>Terms of service</h1>
          <p className="v-meta-line">Last updated: {LAST_UPDATED}</p>

          <h2>1. Acceptance</h2>
          <p>
            By connecting your YouTube channel to Camaleonic Analytics through{' '}
            <code>yt-connector.camaleonicanalytics.com</code>, you agree to these
            Terms and to our{' '}
            <Link href="/privacy" style={{ color: 'var(--v-mint)' }}>
              Privacy policy
            </Link>
            .
          </p>

          <h2>2. The service</h2>
          <p>
            Camaleonic Analytics provides a dashboard that displays the
            audience and engagement metrics of YouTube channels — and the
            YouTube video advertising campaigns — of users who have connected
            their accounts through Google&rsquo;s OAuth flow. Access is
            read-only and limited to the accounts the user owns.
          </p>

          <h2>3. Acceptable use</h2>
          <p>
            You agree not to use the service to:
          </p>
          <ul>
            <li>Access data from channels you do not own or do not have explicit permission to manage.</li>
            <li>Reverse-engineer, scrape, or attempt to bypass authentication.</li>
            <li>Use the data for any purpose that violates YouTube&rsquo;s or Google&rsquo;s policies, or any applicable law.</li>
          </ul>

          <h2>4. YouTube API Services</h2>
          <p>
            This service uses YouTube API Services. By using it, you also agree
            to be bound by the{' '}
            <a
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--v-mint)' }}
            >
              YouTube Terms of Service
            </a>{' '}
            and acknowledge that Google&rsquo;s{' '}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--v-mint)' }}
            >
              Privacy policy
            </a>{' '}
            applies to the information Google shares with us.
          </p>

          <h2>5. Disconnection</h2>
          <p>
            You can disconnect at any time from your Google account at{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--v-mint)' }}
            >
              myaccount.google.com/permissions
            </a>
            . Upon disconnection, we delete the stored tokens and stop reading
            new data; cached metric data is removed within 30 days.
          </p>

          <h2>6. No warranties</h2>
          <p>
            The service is provided &ldquo;as is&rdquo; without warranties of
            any kind. We do not guarantee that the metrics shown will match
            YouTube Studio exactly, since YouTube&rsquo;s API surfaces are
            independent and may differ.
          </p>

          <h2>7. Limitation of liability</h2>
          <p>
            To the extent permitted by law, Camaleonic Analytics is not liable
            for indirect, incidental, or consequential damages arising from the
            use of, or inability to use, the service.
          </p>

          <h2>8. Changes</h2>
          <p>
            We may update these Terms from time to time. The latest version is
            always available at this URL.
          </p>

          <h2>9. Contact</h2>
          <p>
            Questions? Email{' '}
            <a href="mailto:hello@camaleonicanalytics.com">hello@camaleonicanalytics.com</a>.
          </p>
        </div>

        <footer className="v-footer">
          <Link href="/">← Back</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </div>
  );
}

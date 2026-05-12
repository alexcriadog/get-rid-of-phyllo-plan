// Privacy policy. Technical draft — legal team should review before
// submitting to Google OAuth verification.
//
// IMPORTANT: This is the page Google's reviewers will read to confirm
// our data handling matches the scopes we ask for. If you change scope
// requests in lib/youtube.ts, update this page accordingly.

import Link from 'next/link';

const LAST_UPDATED = '2026-05-11';

export default function Privacy() {
  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <span className="v-kicker red">camaleonic analytics</span>
          <span className="v-eyebrow">Privacy policy</span>
        </header>

        <div className="v-legal-prose">
          <h1>Privacy policy</h1>
          <p className="v-meta-line">Last updated: {LAST_UPDATED}</p>

          <p>
            This privacy policy explains how <strong>Camaleonic Analytics</strong>{' '}
            handles personal data when you connect your YouTube channel through{' '}
            <code>yt-connector.camaleonicanalytics.com</code>. By connecting your
            channel you consent to the data handling described below.
          </p>

          <h2>1. Who we are</h2>
          <p>
            Camaleonic Analytics is operated by <strong>Camaleonic S.L.</strong>{' '}
            (replace with the legal entity that will own the verified OAuth
            client). Contact:{' '}
            <a href="mailto:hello@camaleonicanalytics.com">hello@camaleonicanalytics.com</a>.
          </p>

          <h2>2. What data we read from your Google account</h2>
          <p>
            When you click <em>Connect with YouTube</em>, Google asks you to
            authorize the following read-only scopes:
          </p>
          <ul>
            <li>
              <code>openid</code>, <code>userinfo.email</code>,{' '}
              <code>userinfo.profile</code> — to identify the Google account
              that performed the connection (we read your <strong>email</strong>,{' '}
              <strong>display name</strong>, <strong>profile picture URL</strong>,
              and your Google subject ID).
            </li>
            <li>
              <code>youtube.readonly</code> — to read the connected channel&rsquo;s{' '}
              <strong>metadata and videos</strong> (channel title, custom URL,
              subscriber/video/view counts, country, uploads playlist, plus the
              metadata of videos uploaded by the channel).
            </li>
            <li>
              <code>yt-analytics.readonly</code> — to read engagement metrics
              for the connected channel&rsquo;s own content (views, watch time,
              audience demographics, traffic sources).
            </li>
            <li>
              <code>adwords</code> (Google Ads API) — to read the connected
              user&rsquo;s <strong>video advertising campaigns on YouTube</strong>{' '}
              (campaign name, video views, view rate, average cost-per-view,
              total spend) for the campaigns the user themselves runs. We do
              not create, modify, or pause campaigns.
            </li>
          </ul>
          <p>
            We never request scopes that allow us to post, edit, delete, or
            otherwise modify any content on your behalf.
          </p>

          <h2>3. How we use this data</h2>
          <p>
            Data fetched under the scopes above is used <strong>only</strong> to:
          </p>
          <ul>
            <li>Display your channel and its metrics inside your Camaleonic Analytics dashboard.</li>
            <li>Identify which Google account performed the connection for account-linking and audit purposes.</li>
          </ul>
          <p>
            We do <strong>not</strong> use your data to train AI or machine-learning
            models, do <strong>not</strong> sell or share it with advertisers,
            and do <strong>not</strong> use it for any purpose unrelated to the
            features you see in the dashboard.
          </p>

          <h2>4. How long we keep your data</h2>
          <p>
            OAuth tokens issued during a connection performed on this domain
            (<code>yt-connector.camaleonicanalytics.com</code>) are held in memory
            for at most <strong>10 minutes</strong> and are not persisted to disk
            or any database from this service. The dashboard application that
            consumes the verified OAuth client stores tokens encrypted at rest
            and deletes them within 30 days of disconnection.
          </p>
          <p>
            Cached metric data (views, revenue, etc.) is retained for the
            shortest period necessary to render the dashboard, and is deleted
            on request or upon account closure.
          </p>

          <h2>5. Sharing and processors</h2>
          <p>
            We do not share Google user data with third parties for their own
            purposes. We use the following sub-processors strictly to operate
            the service:
          </p>
          <ul>
            <li>Amazon Web Services (EC2, EU/US regions) — hosting.</li>
            <li>Let&rsquo;s Encrypt — TLS certificates.</li>
          </ul>

          <h2>6. Your choices</h2>
          <p>
            You can revoke our access at any time from your Google account at{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--v-mint)' }}
            >
              myaccount.google.com/permissions
            </a>
            . You can also email us at{' '}
            <a href="mailto:hello@camaleonicanalytics.com">hello@camaleonicanalytics.com</a>{' '}
            to request deletion of any data we hold.
          </p>

          <h2>7. Google API Services User Data Policy</h2>
          <p>
            Camaleonic Analytics&rsquo; use and transfer to any other app of
            information received from Google APIs will adhere to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--v-mint)' }}
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>

          <h2>8. Changes to this policy</h2>
          <p>
            We may update this policy from time to time. The latest version is
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
          <Link href="/terms">Terms</Link>
        </footer>
      </div>
    </div>
  );
}

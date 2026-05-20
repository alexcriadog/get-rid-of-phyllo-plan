// Browser-side controller. Talks to our own /api/* server, which in turn
// talks to the Camaleonic API. The Camaleonic key never reaches here.

// Each platform owns a cassette colour from the Cassettine accent palette.
// Stays inside the cassette tape strip — never used as a full surface fill.
const PLATFORM_BADGE = {
  facebook:  { tape: '#3a2bff', label: 'FB' },
  instagram: { tape: '#ff7fd3', label: 'IG' },
  youtube:   { tape: '#ff8b3c', label: 'YT' },
  tiktok:    { tape: '#3cffb8', label: 'TT' },
  threads:   { tape: '#0b0b0b', label: 'TH' },
  twitch:    { tape: '#a06cff', label: 'TW' },
};

const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const userbox = document.getElementById('userbox');
const authForm = document.getElementById('auth-form');
const authErr = document.getElementById('auth-err');
const accountsList = document.getElementById('accounts-list');
const accountsEmpty = document.getElementById('accounts-empty');
const detail = document.getElementById('detail');
const detailTitle = document.getElementById('detail-title');
const detailBody = document.getElementById('detail-body');
const disconnectBtn = document.getElementById('disconnect-btn');

let currentSession = null;
let connectHandle = null;
let detailAccountId = null;

// ─── boot ──────────────────────────────────────────────────────────────────
init();

async function init() {
  const me = await fetch('/api/me').then((r) => (r.ok ? r.json() : null));
  if (me) {
    onLoggedIn(me);
  } else {
    showAuth();
  }
}

// ─── auth ──────────────────────────────────────────────────────────────────
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const action = e.submitter?.dataset?.action ?? 'login';
  const fd = new FormData(authForm);
  const body = JSON.stringify({
    email: fd.get('email'),
    password: fd.get('password'),
  });
  authErr.textContent = '';
  const res = await fetch(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    authErr.textContent = errorMessage(json.error);
    return;
  }
  onLoggedIn(json);
});

function errorMessage(code) {
  switch (code) {
    case 'invalid_credentials': return 'Wrong email or password.';
    case 'email_taken': return 'That email is already registered — try signing in.';
    case 'password_too_short': return 'Password must be at least 6 characters.';
    default: return 'Something went wrong. Try again.';
  }
}

async function onLoggedIn(me) {
  currentSession = me;
  authView.hidden = true;
  dashboardView.hidden = false;
  userbox.innerHTML = `
    <span class="brand-chip">▶ ${escape(me.email)}</span>
    <button id="logout" class="link">Sign out</button>
  `;
  document.getElementById('logout').addEventListener('click', logout);
  initSdk();
  await refreshAccounts();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  currentSession = null;
  showAuth();
}

function showAuth() {
  authView.hidden = false;
  dashboardView.hidden = true;
  userbox.innerHTML = '';
}

// ─── Camaleonic SDK wiring ─────────────────────────────────────────────────
function initSdk() {
  document.querySelectorAll('[data-platform]').forEach((btn) => {
    btn.onclick = () => openConnect(btn.dataset.platform || undefined);
  });
}

async function openConnect(platform) {
  // 1) Ask our backend to mint a fresh SDK token for this user.
  const res = await fetch('/api/sdk-token', { method: 'POST' });
  if (res.status === 401) {
    // Session expired (e.g. server restarted, in-memory store wiped).
    // Drop the user back at the login screen so they can refresh it.
    currentSession = null;
    showAuth();
    document.getElementById('auth-err').textContent =
      'Your session expired. Please sign in again.';
    return;
  }
  if (!res.ok) {
    const body = await res.text();
    console.error('mint-token failed', res.status, body);
    alert(`Could not mint SDK token (HTTP ${res.status}). See console.`);
    return;
  }
  const { sdk_token } = await res.json();

  // 2) Hand the token to the widget and open the popup.
  connectHandle = window.CamaleonicConnect.init({
    sdkToken: sdk_token,
    workspace: currentSession.workspace,
    onSuccess: ({ accountIds, platform }) => {
      console.log('Connected', { accountIds, platform });
      refreshAccounts();
    },
    onError: (err) => {
      console.warn('SDK error', err);
      alert(`Connect failed: ${err.message}`);
    },
    onExit: () => {
      console.log('User closed the popup without finishing.');
    },
  });
  connectHandle.open(platform);
}

// ─── accounts list ─────────────────────────────────────────────────────────
async function refreshAccounts() {
  const res = await fetch('/api/accounts');
  const { data = [] } = await res.json();
  renderAccounts(data);
}

function renderAccounts(accounts) {
  accountsList.innerHTML = '';
  accountsEmpty.hidden = accounts.length > 0;
  for (const a of accounts) {
    const badge = PLATFORM_BADGE[a.platform] ?? { tape: '#8b8f99', label: '??' };
    const handle = a.username || a.handle || a.display_name || a.canonical_user_id;
    const card = document.createElement('button');
    card.className = 'account-card';
    card.innerHTML = `
      <div class="cassette__head">
        <span>${escape(a.platform)}</span>
        <span class="dot" style="background:${badge.tape}"></span>
      </div>
      <div class="cassette__body">
        <div class="cassette__tape" style="background:${badge.tape}">
          <span class="cassette__reel"></span>
          <div class="cassette__avatar">
            ${
              a.profile_image_url
                ? `<img src="${escapeAttr(a.profile_image_url)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${escape(badge.label)}'))" />`
                : `${escape(badge.label)}`
            }
          </div>
          <span class="cassette__reel"></span>
        </div>
        <div class="cassette__handle">${escape(handle)}</div>
        <div class="cassette__meta">
          <span class="pill pill--${statusClass(a)}">${escape(a.status)}</span>
          connected ${friendlyDate(a.connected_at)}
        </div>
      </div>
    `;
    card.onclick = () => openDetail(a);
    accountsList.appendChild(card);
  }
}

function escapeAttr(s) {
  return escape(s);
}

function statusClass(account) {
  if (account.is_test) return 'test';
  if (account.status === 'ready') return 'ready';
  if (account.status === 'disconnected') return 'disconnected';
  return 'error';
}

// ─── detail modal ──────────────────────────────────────────────────────────
async function openDetail(account) {
  detailAccountId = account.id;
  detailTitle.textContent = `${account.platform} · ${account.handle ?? account.canonical_user_id}`;
  detailBody.innerHTML = '<div class="modal-loading">Loading profile…</div>';
  document.getElementById('detail-link').hidden = true;
  detail.showModal();

  const res = await fetch(`/api/accounts/${encodeURIComponent(account.id)}/detail`);
  if (!res.ok) {
    const body = await res.text();
    detailBody.innerHTML = `<pre style="padding:20px">Error (HTTP ${res.status})\n\n${escape(body)}</pre>`;
    return;
  }
  const data = await res.json();
  renderDetail(account, data);
}

function renderDetail(account, data) {
  const id = data.identity ?? {};
  const eng = data.engagement ?? {};
  const ct = data.content?.data ?? [];

  // External profile link
  const link = document.getElementById('detail-link');
  if (id.profile_url) {
    link.href = id.profile_url;
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  const badge = PLATFORM_BADGE[account.platform] ?? { tape: '#8b8f99', label: '??' };
  const totals = eng.totals ?? {};
  const er = typeof eng.engagement_rate === 'number' ? (eng.engagement_rate * 100).toFixed(2) + '%' : '—';

  detailBody.innerHTML = `
    <div class="profile-head">
      <div class="profile-avatar" style="background:${badge.tape}">
        ${
          id.profile_image_url
            ? `<img src="${escapeAttr(id.profile_image_url)}" alt="" referrerpolicy="no-referrer" />`
            : escape(badge.label)
        }
      </div>
      <div class="profile-meta">
        <h2 class="profile-name">${escape(id.full_name || id.username || account.handle || account.canonical_user_id)}</h2>
        <div class="profile-handle">
          @${escape(id.username || account.handle || account.canonical_user_id)}
          ${id.is_verified ? '<span class="verified">verified ✓</span>' : ''}
        </div>
        ${id.biography ? `<p class="profile-bio">${escape(id.biography)}</p>` : ''}
      </div>
    </div>

    <div class="stat-grid">
      ${statTile('Followers', formatN(id.followers_count), 'accent')}
      ${statTile('Following', formatN(id.following_count), 'accent-3')}
      ${statTile('Posts',     formatN(id.posts_count),     'accent-4')}
      ${statTile('Eng. rate', er, 'accent-2', `${eng.window?.sample_size ?? 0} posts sampled`)}
    </div>

    <div class="stat-grid">
      ${statTile('Likes',    formatN(totals.likes),    'accent-3', 'totals')}
      ${statTile('Comments', formatN(totals.comments), 'accent-3', 'totals')}
      ${statTile('Shares',   formatN(totals.shares),   'accent-3', 'totals')}
      ${statTile('Views',    formatN(totals.views),    'accent-3', 'totals')}
    </div>

    ${ct.length ? `
      <div class="section-title">Recent content</div>
      <div class="content-grid">
        ${ct.slice(0, 6).map(renderThumb).join('')}
      </div>
    ` : ''}
  `;
}

function statTile(label, value, accent = '', subvalue = '') {
  return `
    <div class="stat-tile ${accent ? 'stat-tile--' + accent : ''}">
      <div class="label">${escape(label)}</div>
      <div class="value">${escape(value)}</div>
      ${subvalue ? `<div class="subvalue">${escape(subvalue)}</div>` : ''}
    </div>
  `;
}

function renderThumb(item) {
  const thumb = item.thumbnailUrl || item.thumbnail_url || (item.mediaUrls && item.mediaUrls[0]) || '';
  const caption = (item.caption || item.title || '').slice(0, 120);
  const metrics = item.metrics ?? {};
  const url = item.permalink || item.permalink_url || '';
  const body = `
    <div class="content-thumb__media" style="${thumb ? `background-image:url('${escapeAttr(thumb)}')` : ''}"></div>
    ${caption ? `<div class="content-thumb__caption">${escape(caption)}</div>` : ''}
    <div class="content-thumb__metrics">
      ${metrics.likes != null ? `<span>♥ ${formatN(metrics.likes)}</span>` : ''}
      ${metrics.comments != null ? `<span>💬 ${formatN(metrics.comments)}</span>` : ''}
      ${metrics.views != null ? `<span>▶ ${formatN(metrics.views)}</span>` : ''}
    </div>
  `;
  return url
    ? `<a class="content-thumb" href="${escapeAttr(url)}" target="_blank" rel="noopener">${body}</a>`
    : `<div class="content-thumb">${body}</div>`;
}

function formatN(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'k';
  return String(v);
}

detail.querySelector('[data-close]').onclick = () => detail.close();
disconnectBtn.onclick = async () => {
  if (!detailAccountId) return;
  if (!confirm('Disconnect this account? Tokens will be revoked.')) return;
  const res = await fetch(`/api/accounts/${encodeURIComponent(detailAccountId)}`, {
    method: 'DELETE',
  });
  if (res.ok) {
    detail.close();
    refreshAccounts();
  } else {
    alert('Disconnect failed.');
  }
};

// ─── helpers ───────────────────────────────────────────────────────────────
function escape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function friendlyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

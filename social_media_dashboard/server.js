// Sample client dashboard for Camaleonic Connect.
//
// Architecture:
//   Browser  ──►  Express (this file)  ──►  Camaleonic API
//                  │                          │
//                  │  session cookie          │  cmlk_live_* bearer
//                  ▼                          ▼
//                in-memory users        live OAuth + token custody
//
// What this server does:
//   • Holds a tiny user table in memory (email → SHA-256 hash + salt).
//     Good enough for a demo; real apps use a DB + bcrypt/argon2.
//   • Mints SDK tokens scoped to the logged-in user, so the popup binds
//     the resulting account to THAT user only.
//   • Proxies /v1/accounts read calls, filtering by `end_user_id` =
//     logged-in user's email so each user only sees their own accounts.
//   • Forwards disconnects.
//
// The Camaleonic API key NEVER leaves the server.

import express from 'express';
import session from 'express-session';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);
const API_KEY = process.env.CAMALEONIC_API_KEY;
const BASE_URL =
  process.env.CAMALEONIC_BASE_URL ?? 'https://smconnector.camaleonicanalytics.com';
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? 'demo';
const SESSION_SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');

if (!API_KEY) {
  console.error('Missing CAMALEONIC_API_KEY — copy .env.example to .env');
  process.exit(1);
}

// ─── in-memory user table ───────────────────────────────────────────────────
// Map<email, { passwordHash: string }>
const users = new Map();

function hashPassword(password, salt) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

function constantTimeEq(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ─── Camaleonic API helpers ─────────────────────────────────────────────────
async function camaleonic(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

// ─── app ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 },
  }),
);
app.use(express.static(join(HERE, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.email) return res.status(401).json({ error: 'not_logged_in' });
  next();
}

// ─── auth routes ────────────────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  if (users.has(email.toLowerCase())) {
    return res.status(409).json({ error: 'email_taken' });
  }
  const salt = randomBytes(8).toString('hex');
  users.set(email.toLowerCase(), {
    passwordHash: `${salt}:${hashPassword(password, salt)}`,
  });
  req.session.email = email.toLowerCase();
  res.json({ email: email.toLowerCase() });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const u = users.get(email.toLowerCase());
  if (!u) return res.status(401).json({ error: 'invalid_credentials' });
  const [salt, expected] = u.passwordHash.split(':');
  if (!constantTimeEq(expected, hashPassword(password, salt))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  req.session.email = email.toLowerCase();
  res.json({ email: email.toLowerCase() });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.email) return res.status(401).json({ error: 'not_logged_in' });
  res.json({ email: req.session.email, workspace: WORKSPACE_SLUG });
});

// ─── Camaleonic proxy routes ────────────────────────────────────────────────

// Mint an SDK token scoped to the logged-in user. The browser receives the
// short-lived JWT but never the long-lived API key.
app.post('/api/sdk-token', requireAuth, async (req, res) => {
  const { status, body } = await camaleonic('/v1/sdk-tokens', {
    method: 'POST',
    body: JSON.stringify({
      user_id: req.session.email,
      ttl: 1800,
    }),
  });
  res.status(status).json(body);
});

// List accounts belonging to the logged-in user. Scoping is enforced
// server-side via the `end_user_id` query param.
app.get('/api/accounts', requireAuth, async (req, res) => {
  const qs = new URLSearchParams({
    end_user_id: req.session.email,
    limit: '100',
  });
  const { status, body } = await camaleonic(`/v1/accounts?${qs}`);
  res.status(status).json(body);
});

// Read normalized identity for one of the user's accounts. Double-check
// ownership before fetching — never trust the id from the URL.
app.get('/api/accounts/:id/identity', requireAuth, async (req, res) => {
  const { id } = req.params;
  const meta = await camaleonic(`/v1/accounts/${encodeURIComponent(id)}`);
  if (!meta.ok) return res.status(meta.status).json(meta.body);
  if (meta.body?.end_user_id !== req.session.email) {
    return res.status(404).json({ error: 'not_found' });
  }
  const identity = await camaleonic(
    `/v1/accounts/${encodeURIComponent(id)}/identity`,
  );
  res.status(identity.status).json(identity.body);
});

// Disconnect (DELETE). Same ownership check as identity.
app.delete('/api/accounts/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const meta = await camaleonic(`/v1/accounts/${encodeURIComponent(id)}`);
  if (!meta.ok) return res.status(meta.status).json(meta.body);
  if (meta.body?.end_user_id !== req.session.email) {
    return res.status(404).json({ error: 'not_found' });
  }
  const result = await camaleonic(`/v1/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  res.status(result.status).json(result.body);
});

// ─── boot ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Social Media Dashboard ready on http://localhost:${PORT}`);
  console.log(`  Workspace: ${WORKSPACE_SLUG}`);
  console.log(`  Connect-UI: ${BASE_URL}`);
});

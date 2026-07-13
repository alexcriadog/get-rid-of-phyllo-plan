import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { signIn } from 'next-auth/react';
import { safeCallback } from '@/lib/safe-callback';

export default function LoginPage() {
  const router = useRouter();
  const callbackUrl = safeCallback(router.query.callbackUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const disabled = busy || email.trim() === '' || password === '';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });
    setBusy(false);
    if (res?.error) {
      setError('Invalid credentials');
      return;
    }
    router.push(callbackUrl);
  }

  return (
    <>
      <Head>
        <title>Sign in — Camaleonic Connect</title>
      </Head>
      <div className="flex min-h-screen items-center justify-center bg-term-bg px-6 text-term-text">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-sm border border-term-line bg-term-surface p-8"
          aria-label="Operator sign in"
        >
          <div className="mb-8 flex items-center gap-3">
            <span aria-hidden className="font-mono text-2xl font-bold text-term-mint">⫿</span>
            <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-term-faint">
              CAMALEONIC CONNECT
            </span>
          </div>
          <label
            className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-term-muted"
            htmlFor="email"
          >
            User
          </label>
          <input
            id="email"
            type="text"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full border border-term-line bg-term-bg px-3 py-2 font-mono text-sm text-term-text focus:border-term-mint focus:outline-none"
          />
          <label
            className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-term-muted"
            htmlFor="password"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-6 w-full border border-term-line bg-term-bg px-3 py-2 font-mono text-sm text-term-text focus:border-term-mint focus:outline-none"
          />
          {error && (
            <p role="alert" className="mb-4 font-mono text-xs text-term-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={disabled}
            className="w-full border border-term-mint bg-term-mint/10 px-3 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-term-mint transition-colors hover:bg-term-mint/20 disabled:opacity-40"
          >
            {busy ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
        </form>
      </div>
    </>
  );
}

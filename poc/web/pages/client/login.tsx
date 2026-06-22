import { useState } from 'react';
import { useRouter } from 'next/router';
import { KeyRound, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function ClientLoginPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/client/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const rt = router.query.return_to;
      const dest =
        typeof rt === 'string' && rt.startsWith('/client') ? rt : '/client';
      router.push(dest);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
              <Zap className="h-4 w-4" />
            </span>
            <div>
              <div className="text-base font-semibold">Camaleonic Connect</div>
              <div className="text-xs text-muted-foreground">
                Client dashboard
              </div>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                <KeyRound className="h-3 w-3" /> API key
              </label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="cmlk_live_..."
                autoFocus
                type="password"
                className="font-mono"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Paste your workspace API key. Don't have one? Ask your operator
                to issue one from the admin dashboard.
              </p>
            </div>

            {error && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                ↯ {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy || !apiKey.trim()}
              className="w-full"
            >
              {busy ? 'Verifying…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            Session lasts 1 hour. Your key is stored HttpOnly server-side; the
            browser never sees it after submit.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

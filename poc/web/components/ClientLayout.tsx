import { ReactNode, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { LogOut, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  title: string;
  environment?: 'live' | 'test' | null;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Minimal layout for /client/* pages. Distinct from AdminLayout — clients
 * see only their own surface, no sidebar nav across workspaces, and a
 * visible "TEST MODE" banner when the session was minted with a
 * cmlk_test_* key.
 */
export default function ClientLayout({
  title,
  environment,
  children,
  actions,
}: Props) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/client/logout', { method: 'POST' });
    } finally {
      router.push('/client/login');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {environment === 'test' && (
        <div className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-warn">
          Test mode — accounts connected here are marked is_test=true and
          webhooks are suppressed.
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-8">
        <Link href="/client" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <Zap className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            Camaleonic Connect
          </span>
        </Link>
        <h1 className="ml-4 truncate text-base font-semibold tracking-tight text-muted-foreground">
          {title}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="sm"
            disabled={loggingOut}
            onClick={onLogout}
            title="Log out"
          >
            <LogOut className="h-3.5 w-3.5" /> Logout
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}

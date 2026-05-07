import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useState } from 'react';
import {
  Activity,
  Clock,
  Database,
  Eye,
  ExternalLink,
  FileJson,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Lock,
  Menu,
  Plug2,
  Repeat,
  TableProperties,
  Users,
  Webhook,
  Zap,
} from 'lucide-react';
import { useLive } from '../lib/useLive';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type NavSection = { title: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    title: 'Live',
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard },
      { href: '/admin/calls', label: 'API calls', icon: Activity },
      { href: '/admin/events', label: 'Events', icon: ListOrdered },
      { href: '/admin/webhooks', label: 'Webhooks', icon: Webhook },
    ],
  },
  {
    title: 'Accounts',
    items: [
      { href: '/admin/accounts', label: 'Accounts', icon: Users },
      { href: '/admin/connect', label: 'Connect new', icon: Plug2 },
      { href: '/admin/watchlist', label: 'Watchlist', icon: Eye },
    ],
  },
  {
    title: 'Policy',
    items: [
      { href: '/admin/rate-limits', label: 'Rate buckets', icon: Gauge },
      { href: '/admin/cadence', label: 'Cadence', icon: Repeat },
      { href: '/admin/next-runs', label: 'Next runs', icon: Clock },
      { href: '/admin/throttle-locks', label: 'Throttle locks', icon: Lock },
    ],
  },
  {
    title: 'Audit',
    items: [
      { href: '/admin/raw', label: 'Raw responses', icon: FileJson },
      { href: '/admin/support-matrix', label: 'Support matrix', icon: TableProperties },
    ],
  },
];

type Props = {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
};

type SystemHealth = {
  mysql: { ok: boolean; latency_ms: number | null; error?: string };
  mongo: { ok: boolean; latency_ms: number | null; error?: string };
  redis: { ok: boolean; latency_ms: number | null; error?: string };
  worker: { last_attempt_at: string | null; idle_seconds: number | null };
  summary: 'ok' | 'warn' | 'danger';
};

export default function AdminLayout({ title, children, actions }: Props) {
  const health = useLive<SystemHealth>('/admin/system/health', 5000);
  const apiDown = !!health.error && !health.data;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-card/40 lg:flex lg:flex-col">
            <SidebarContent />
          </aside>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-72 p-0">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-8">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu />
              </Button>
              <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
              <div className="ml-auto flex items-center gap-2">
                {actions}
                <SystemHealthBadge health={health.data} apiDown={apiDown} />
              </div>
            </header>

            <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
              {apiDown && (
                <div className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
                  Connector API unreachable. Start the connector with{' '}
                  <code className="rounded bg-background/40 px-1.5 py-0.5 font-mono text-xs">
                    npm run dev:api
                  </code>{' '}
                  in <code className="rounded bg-background/40 px-1.5 py-0.5 font-mono text-xs">poc/</code>.{' '}
                  <span className="text-danger/80">{health.error}</span>
                </div>
              )}
              {children}
            </main>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
          <Zap className="h-3.5 w-3.5" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Connector
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
            Admin
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((section) => (
          <div key={section.title} className="mb-5 last:mb-0">
            <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  router.pathname === item.href ||
                  (item.href !== '/admin' && router.pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                        active
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 transition-colors',
                          active
                            ? 'text-primary'
                            : 'text-muted-foreground/70 group-hover:text-foreground',
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Public UI
        </Link>
      </div>
    </div>
  );
}

function SystemHealthBadge({
  health,
  apiDown,
}: {
  health: SystemHealth | null;
  apiDown: boolean;
}) {
  if (apiDown) {
    return (
      <Badge variant="danger" className="gap-1.5 px-2.5 py-1">
        <Dot tone="bg-danger" pulse />
        API down
      </Badge>
    );
  }
  if (!health) {
    return (
      <Badge variant="default" className="gap-1.5 px-2.5 py-1">
        <Dot tone="bg-muted-foreground" pulse />
        connecting…
      </Badge>
    );
  }

  const variant: 'ok' | 'warn' | 'danger' =
    health.summary === 'ok' ? 'ok' : health.summary === 'warn' ? 'warn' : 'danger';
  const dotTone =
    variant === 'ok' ? 'bg-ok' : variant === 'warn' ? 'bg-warn' : 'bg-danger';
  const idleTxt = formatIdle(health.worker.idle_seconds);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className="cursor-default items-center gap-2 px-2.5 py-1">
          <Dot tone={dotTone} pulse={variant !== 'ok'} />
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <Database className="h-3 w-3 opacity-70" />
            <span>healthy</span>
          </span>
          <span className="inline sm:hidden">{variant.toUpperCase()}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-[11px] leading-relaxed">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">MySQL</span>
          <span>{health.mysql.ok ? `${health.mysql.latency_ms}ms` : 'down'}</span>
          <span className="text-muted-foreground">Mongo</span>
          <span>{health.mongo.ok ? `${health.mongo.latency_ms}ms` : 'down'}</span>
          <span className="text-muted-foreground">Redis</span>
          <span>{health.redis.ok ? `${health.redis.latency_ms}ms` : 'down'}</span>
          <span className="text-muted-foreground">Worker</span>
          <span>{idleTxt}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function Dot({ tone, pulse }: { tone: string; pulse?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full',
        tone,
        pulse && 'animate-pulse-soft',
      )}
    />
  );
}

function formatIdle(seconds: number | null): string {
  if (seconds == null) return 'never ran';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

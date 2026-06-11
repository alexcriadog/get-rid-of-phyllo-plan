import Head from 'next/head';
import type { ReactNode } from 'react';
import ThemeToggle from '@/components/ThemeToggle';
import ActionChip from '@/components/term/ActionChip';
import FeedLine from '@/components/term/FeedLine';
import PlatformTag from '@/components/term/PlatformTag';
import StatBlock from '@/components/term/StatBlock';
import TermInput from '@/components/term/TermInput';
import TermTable, { type TermColumn } from '@/components/term/TermTable';
import { Gauge, MiniBar, Sparkline } from '@/components/term/charts';
import { PLATFORM_TAGS } from '@/lib/term/platforms';

interface SpecimenRow {
  id: string;
  account: string;
  platform: string;
  status: 'live' | 'expired';
}

const TABLE_ROWS: SpecimenRow[] = [
  { id: '1', account: '@glossier', platform: 'instagram', status: 'live' },
  { id: '2', account: '@duolingo', platform: 'tiktok', status: 'live' },
  { id: '3', account: '@nike', platform: 'instagram', status: 'expired' },
];

const TABLE_COLUMNS: TermColumn<SpecimenRow>[] = [
  { key: 'account', header: 'Account', render: (r) => r.account },
  {
    key: 'platform',
    header: 'Platform',
    render: (r) => <PlatformTag platform={r.platform} showLabel />,
  },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    render: (r) => (
      <span className={r.status === 'live' ? 'text-term-mint' : 'text-term-danger'}>
        <span aria-hidden="true">● </span>
        {r.status}
      </span>
    ),
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border border-term-line bg-term-surface">
      <div className="border-b border-term-line px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-term-muted">
        ⫿ {title}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function TermSpecimen() {
  return (
    <main className="min-h-screen bg-term-bg p-6 font-mono text-term-text lg:p-10">
      <Head>
        <title>Term Specimen — Camaleonic Connect</title>
      </Head>

      <header className="mb-8 flex items-center gap-4">
        <span className="grid h-8 w-8 place-items-center border-2 border-term-mint" aria-hidden="true" />
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">
            MINT TERMINAL <span className="text-term-mint">SPECIMEN</span>
          </h1>
          <p className="text-xs text-term-faint">Ops Terminal design system v2 — phase 1 primitives</p>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="StatBlock">
          <div className="flex flex-wrap gap-8">
            <StatBlock label="syncs / 24h" value={48204} delta={{ text: '12% vs prev', tone: 'up' }} />
            <StatBlock label="success" value="99.4%" sub="stable" />
            <StatBlock label="needs attention" value={3} delta={{ text: '2 reauth · 1 DLQ', tone: 'down' }} />
          </div>
        </Section>

        <Section title="ActionChip">
          <div className="flex flex-wrap items-center gap-2">
            <ActionChip variant="primary">primary ▸</ActionChip>
            <ActionChip>action</ActionChip>
            <ActionChip variant="ghost">ghost</ActionChip>
            <ActionChip variant="destructive">destructive</ActionChip>
            <ActionChip disabled>disabled</ActionChip>
            <ActionChip size="sm">sm</ActionChip>
          </div>
        </Section>

        <Section title="PlatformTag">
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.keys(PLATFORM_TAGS).map((p) => (
              <PlatformTag key={p} platform={p} showLabel />
            ))}
            <PlatformTag platform="myspace" showLabel />
          </div>
        </Section>

        <Section title="TermInput">
          <TermInput placeholder="filter: platform=tiktok status=err" />
        </Section>

        <Section title="FeedLine">
          <FeedLine time="12:04:11" platform="instagram" status={{ text: 'OK 142ms', tone: 'ok' }}>
            @glossier profile_sync
          </FeedLine>
          <FeedLine time="12:04:02" platform="linkedin" status={{ text: 'QUEUED', tone: 'queued' }}>
            token_refresh org:camaleonic
          </FeedLine>
          <FeedLine time="12:03:39" platform="tiktok" status={{ text: 'ERR 429 → backoff 2m', tone: 'danger' }}>
            @ryanair audience_demo
          </FeedLine>
          <div className="text-xs text-term-faint">
            tail -f · streaming<span className="animate-term-blink">▮</span>
          </div>
        </Section>

        <Section title="Charts">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs">
              <span className="w-24 text-term-muted">sync:profile</span>
              <MiniBar value={12} max={400} label="sync:profile queue depth" /> <span>12</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="w-24 text-term-muted">sync:content</span>
              <MiniBar value={347} max={400} tone="warn" label="sync:content queue depth" /> <span>347</span>
            </div>
            <Sparkline points={[10, 14, 12, 22, 18, 30, 26, 34]} />
            <Gauge value={0.42} label="content queue" />
            <Gauge value={0.95} label="rate limit: tiktok" />
          </div>
        </Section>

        <Section title="TermTable">
          <TermTable columns={TABLE_COLUMNS} rows={TABLE_ROWS} rowKey={(r) => r.id} activeKey="2" />
        </Section>

        <Section title="Empty state">
          <TermTable
            columns={TABLE_COLUMNS}
            rows={[]}
            rowKey={(r: SpecimenRow) => r.id}
            empty="no accounts match"
          />
        </Section>
      </div>
    </main>
  );
}

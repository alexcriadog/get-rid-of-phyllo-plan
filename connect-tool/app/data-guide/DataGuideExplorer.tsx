'use client';

import { useEffect, useMemo, useState } from 'react';
import './data-guide.css';
import {
  PLATFORMS,
  PRODUCTS,
  TOKENS,
  type FieldTableName,
  type GuideData,
  type GuideField,
  type GuideTable,
  type Platform,
} from './types';

type Tab = 'Products' | FieldTableName | 'Tokens';

interface Props {
  guide: GuideData;
}

/** Group fields by `family`, core first then alphabetical (prototype order). */
function groupByFamily(fields: GuideField[]): Array<[string, GuideField[]]> {
  const fams: Record<string, GuideField[]> = {};
  for (const f of fields) (fams[f.family] ??= []).push(f);
  const order = Object.keys(fams).sort((a, b) =>
    a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b),
  );
  return order.map((fam) => [fam, fams[fam]]);
}

/** Tri-state capability cell: ✓ / ✓△ / —. */
function Cell({ field, platform }: { field: GuideField; platform: Platform }) {
  if (!field.support[platform]) return <span className="na">—</span>;
  const caveat = field.caveat?.[platform];
  return (
    <>
      <span className="on">✓</span>
      {caveat && (
        <span className="cav" title={caveat}>
          △
        </span>
      )}
    </>
  );
}

function filterFields(
  fields: GuideField[],
  visiblePlatforms: Platform[],
  onlyOffered: boolean,
  q: string,
): GuideField[] {
  let rows = fields;
  if (q) {
    rows = rows.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.desc || '').toLowerCase().includes(q) ||
        (f.type || '').includes(q),
    );
  }
  if (onlyOffered) {
    rows = rows.filter((f) => visiblePlatforms.some((p) => f.support[p]));
  }
  return rows;
}

/** Build the toolbar count label, matching the prototype's `// …` strings. */
function countLabelFor(
  guide: GuideData,
  tab: Tab,
  visiblePlatforms: Platform[],
  onlyOffered: boolean,
  q: string,
): string {
  if (tab === 'Products') {
    return `// ${visiblePlatforms.length} platforms · ${PRODUCTS.length} products`;
  }
  if (tab === 'Tokens') {
    const shown = TOKENS.filter((t) => visiblePlatforms.includes(t.platform)).length;
    return `// ${shown} platforms`;
  }
  const table = guide.tables[tab];
  const rows = filterFields(table.fields, visiblePlatforms, onlyOffered, q);
  const offeredN = visiblePlatforms.filter((c) => table.offered[c]).length;
  return `// ${rows.length} of ${table.fields.length} fields · offered on ${offeredN}/${visiblePlatforms.length} platforms`;
}

export function DataGuideExplorer({ guide }: Props) {
  const fieldTableNames = useMemo(
    () => Object.keys(guide.tables) as FieldTableName[],
    [guide.tables],
  );
  const tabs = useMemo<Tab[]>(
    () => ['Products', ...fieldTableNames, 'Tokens'],
    [fieldTableNames],
  );

  const [activeTab, setActiveTab] = useState<Tab>('Identity');
  const [hiddenPlatforms, setHiddenPlatforms] = useState<Set<Platform>>(new Set());
  const [onlyOffered, setOnlyOffered] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());
  // Default to dark (the operator console's default) and inherit the admin's
  // saved theme from same-origin localStorage so the guide stays consistent
  // with the rest of the app instead of forcing white.
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    try {
      const stored = localStorage.getItem('admin.theme.v1');
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    } catch {
      // localStorage unavailable — keep the dark default.
    }
  }, []);
  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('admin.theme.v1', next);
      } catch {
        // ignore persistence failures
      }
      return next;
    });

  const visiblePlatforms = useMemo(
    () => PLATFORMS.filter((p) => !hiddenPlatforms.has(p)),
    [hiddenPlatforms],
  );

  const togglePlatform = (p: Platform) =>
    setHiddenPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const toggleFamily = (key: string) =>
    setCollapsedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const tabCount = (t: Tab): string | number => {
    if (t === 'Products') return `${PLATFORMS.length}×${PRODUCTS.length}`;
    if (t === 'Tokens') return PLATFORMS.length;
    return guide.tables[t].fields.length;
  };

  const q = query.trim().toLowerCase();
  const showOnlyOffered = activeTab !== 'Products' && activeTab !== 'Tokens';
  const countLabel = countLabelFor(guide, activeTab, visiblePlatforms, onlyOffered, q);

  return (
    <div className="dg-root" data-theme={theme}>
      <div className="bar">
        <a className="backbtn" href="/admin" aria-label="Back to admin console">
          ← Back
        </a>
        <span className="brand">
          <span className="dot" />
          Camaleonic Connect
          <span className="sub">DATA&nbsp;GUIDE</span>
        </span>
        <span className="stamp">
          <span className="live" />
          capabilities · generated&nbsp;<b>{guide.generatedAt}</b>
        </span>
        <span className="grow" />
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search field, description or type…"
          aria-label="Search fields"
        />
        <button
          className="iconbtn"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          ◐
        </button>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            className="tab"
            role="tab"
            aria-selected={t === activeTab}
            onClick={() => setActiveTab(t)}
          >
            {t} <span className="n">{tabCount(t)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <span className="tlabel">platforms</span>
        <span className="pchips">
          {PLATFORMS.map((p) => (
            <span
              key={p}
              className="pchip"
              data-off={hiddenPlatforms.has(p) ? '1' : '0'}
              onClick={() => togglePlatform(p)}
            >
              <i />
              {p}
            </span>
          ))}
        </span>
        {showOnlyOffered && (
          <button
            className="toggle2"
            aria-pressed={onlyOffered}
            onClick={() => setOnlyOffered((v) => !v)}
          >
            only offered
          </button>
        )}
        <span className="legend">
          <span className="on">✓</span>offered
          <span className="cav">✓△</span>with&nbsp;caveat
          <span className="na">—</span>n/a
        </span>
        <span className="count">{countLabel}</span>
      </div>

      <div className="grid">
        {activeTab === 'Products' ? (
          <ProductsTable guide={guide} visiblePlatforms={visiblePlatforms} />
        ) : activeTab === 'Tokens' ? (
          <TokensTable hiddenPlatforms={hiddenPlatforms} />
        ) : (
          <FieldTable
            tab={activeTab}
            table={guide.tables[activeTab]}
            audienceNote={guide.audienceNote}
            visiblePlatforms={visiblePlatforms}
            onlyOffered={onlyOffered}
            query={q}
            collapsedFamilies={collapsedFamilies}
            onToggleFamily={toggleFamily}
          />
        )}
      </div>
    </div>
  );
}

interface FieldTableProps {
  tab: FieldTableName;
  table: GuideTable;
  audienceNote: string;
  visiblePlatforms: Platform[];
  onlyOffered: boolean;
  query: string;
  collapsedFamilies: Set<string>;
  onToggleFamily: (key: string) => void;
}

function FieldTable({
  tab,
  table,
  audienceNote,
  visiblePlatforms,
  onlyOffered,
  query,
  collapsedFamilies,
  onToggleFamily,
}: FieldTableProps) {
  const rows = filterFields(table.fields, visiblePlatforms, onlyOffered, query);
  const note =
    tab === 'Audience' && audienceNote ? (
      <div className="anote">
        <b>Audience is offered on 6 platforms.</b> {audienceNote}
      </div>
    ) : null;

  if (rows.length === 0) {
    return (
      <>
        {note}
        <div className="empty">no fields match “{query}”</div>
      </>
    );
  }

  const span = 3 + visiblePlatforms.length;

  return (
    <>
      {note}
      <table>
        <thead>
          <tr>
            <th className="c-field">Field</th>
            <th>Type</th>
            <th className="c-desc" style={{ textAlign: 'left' }}>
              Description
            </th>
            {visiblePlatforms.map((p) => (
              <th key={p} className={table.offered[p] ? '' : 'dim'}>
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupByFamily(rows).map(([fam, fs]) => {
            const key = `${tab}|${fam}`;
            return (
              <FamilyGroup
                key={key}
                famKey={key}
                family={fam}
                fields={fs}
                span={span}
                collapsed={collapsedFamilies.has(key)}
                visiblePlatforms={visiblePlatforms}
                onToggle={onToggleFamily}
              />
            );
          })}
        </tbody>
      </table>
    </>
  );
}

interface FamilyGroupProps {
  famKey: string;
  family: string;
  fields: GuideField[];
  span: number;
  collapsed: boolean;
  visiblePlatforms: Platform[];
  onToggle: (key: string) => void;
}

function FamilyGroup({
  famKey,
  family,
  fields,
  span,
  collapsed,
  visiblePlatforms,
  onToggle,
}: FamilyGroupProps) {
  return (
    <>
      <tr className="fam" onClick={() => onToggle(famKey)}>
        <td colSpan={span}>
          <span className="caret">{collapsed ? '▸' : '▾'}</span>
          {family}
          <span className="cnt">{fields.length}</span>
        </td>
      </tr>
      {!collapsed &&
        fields.map((f) => (
          <tr key={f.name}>
            <td className="c-field">
              {f.name}
              {f.maturity && f.maturity !== 'production' && (
                <span className={`mat mat-${f.maturity}`}>{f.maturity}</span>
              )}
            </td>
            <td className="type" data-t={f.type || ''}>
              {f.type || ''}
            </td>
            <td className="c-desc">
              {f.desc || <span style={{ opacity: 0.4 }}>—</span>}
            </td>
            {visiblePlatforms.map((p) => (
              <td key={p}>
                <Cell field={f} platform={p} />
              </td>
            ))}
          </tr>
        ))}
    </>
  );
}

function ProductsTable({
  guide,
  visiblePlatforms,
}: {
  guide: GuideData;
  visiblePlatforms: Platform[];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th className="c-field">Platform</th>
          {PRODUCTS.map(([, label]) => (
            <th key={label}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visiblePlatforms.map((p) => {
          const have = new Set(guide.productsByPlatform[p] ?? []);
          return (
            <tr key={p}>
              <td className="c-field plat-row">
                <span className="pd" />
                {p}
              </td>
              {PRODUCTS.map(([id, label]) => (
                <td key={label}>
                  {have.has(id) ? (
                    <span className="cellbox">✓</span>
                  ) : (
                    <span className="na">—</span>
                  )}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TokensTable({ hiddenPlatforms }: { hiddenPlatforms: Set<Platform> }) {
  const rows = TOKENS.filter((t) => !hiddenPlatforms.has(t.platform));
  return (
    <table>
      <thead>
        <tr>
          <th className="c-field">Platform</th>
          <th style={{ textAlign: 'left' }}>Access token life</th>
          <th>Auto-refresh</th>
          <th className="note" style={{ textAlign: 'left' }}>
            Notes
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.platform}>
            <td className="c-field plat-row">
              <span className="pd" />
              {t.platform}
            </td>
            <td className="c-desc mono" style={{ color: 'var(--dg-dim)' }}>
              {t.life}
            </td>
            <td>
              {t.autoRefresh ? (
                <span className="on">✓ yes</span>
              ) : (
                <span className="off">— long-lived</span>
              )}
            </td>
            <td className="note">{t.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

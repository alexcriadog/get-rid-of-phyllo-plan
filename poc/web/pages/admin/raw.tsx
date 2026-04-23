import { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { CONNECTOR_API_URL } from '../../lib/api';
import { fmtTime, fmtNumber, truncate } from '../../lib/format';

type RawMeta = {
  id: string;
  platform?: string;
  endpoint?: string;
  size_bytes?: number;
  account_id?: number | string;
  fetched_at?: string;
  hash?: string;
};

export default function RawPage() {
  const [accountFilter, setAccountFilter] = useState('');
  const qs = new URLSearchParams();
  if (accountFilter) qs.set('account_id', accountFilter);
  qs.set('limit', '50');

  const { data, error } = useLive<RawMeta[]>(`/admin/raw-responses?${qs.toString()}`, 5000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBody, setSelectedBody] = useState<unknown | null>(null);
  const [selectedErr, setSelectedErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedId) return;
    setSelectedBody(null);
    setSelectedErr(null);
    fetch(`${CONNECTOR_API_URL}/admin/raw-responses/${selectedId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => setSelectedBody(j))
      .catch((e) => setSelectedErr((e as Error).message));
  }, [selectedId]);

  return (
    <AdminLayout title="Raw responses">
      {error && !data && <div className="banner">{error}</div>}

      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <input
            placeholder="filter by account id"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            style={{ width: 200 }}
          />
          <div className="spacer" />
          <span className="faint mono" style={{ fontSize: 11 }}>
            {data?.length ?? 0} blobs
          </span>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
      >
        {(data || []).map((r) => (
          <div
            key={r.id}
            className="panel"
            style={{ cursor: 'pointer' }}
            onClick={() => setSelectedId(r.id)}
          >
            <div className="row">
              <span className="badge">{r.platform}</span>
              <div className="spacer" />
              <span className="faint" style={{ fontSize: 11 }}>
                {fmtTime(r.fetched_at)}
              </span>
            </div>
            <div
              className="mono"
              style={{
                fontSize: 12,
                marginTop: 'var(--space-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {truncate(r.endpoint, 80)}
            </div>
            <div className="row" style={{ marginTop: 'var(--space-2)', gap: 10, fontSize: 11 }}>
              <span className="mono">{fmtNumber(r.size_bytes)} bytes</span>
              <span className="mono faint">acc {r.account_id}</span>
              {r.hash && <span className="mono faint">{truncate(r.hash, 10)}</span>}
            </div>
          </div>
        ))}
        {(!data || data.length === 0) && <div className="panel muted">No raw responses yet.</div>}
      </div>

      {selectedId && (
        <div
          onClick={() => setSelectedId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            className="panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 900, width: '95%', maxHeight: '85vh', overflow: 'auto' }}
          >
            <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="panel-title" style={{ margin: 0 }}>
                Raw response {selectedId}
              </div>
              <div className="spacer" />
              <button onClick={() => setSelectedId(null)}>Close</button>
            </div>
            {selectedErr && <div className="banner">{selectedErr}</div>}
            {!selectedBody && !selectedErr && <div className="muted">Loading…</div>}
            {selectedBody ? (
              <CollapsibleJson
                value={selectedBody}
                expanded={expanded}
                setExpanded={setExpanded}
                path="$"
              />
            ) : null}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function CollapsibleJson({
  value,
  expanded,
  setExpanded,
  path,
}: {
  value: unknown;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  path: string;
}): JSX.Element {
  const isArray = Array.isArray(value);
  const isObj = value !== null && typeof value === 'object';

  const toggle = () =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (!isObj) {
    return (
      <span
        className="mono"
        style={{
          color:
            typeof value === 'string'
              ? '#9cbcff'
              : typeof value === 'number'
              ? '#f7c873'
              : 'var(--text)',
        }}
      >
        {JSON.stringify(value)}
      </span>
    );
  }

  const open = expanded.has(path);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);

  const brackets = isArray ? ['[', ']'] : ['{', '}'];

  if (!open) {
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        style={{ cursor: 'pointer', color: 'var(--accent)' }}
        className="mono"
      >
        {brackets[0]} … {entries.length} {isArray ? 'items' : 'keys'} … {brackets[1]}
      </span>
    );
  }

  return (
    <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 12, marginLeft: 4 }}>
      <span
        className="mono"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        style={{ cursor: 'pointer', color: 'var(--accent)' }}
      >
        {brackets[0]}
      </span>
      {entries.map(([k, v]) => (
        <div key={k} className="mono" style={{ marginLeft: 12, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>{JSON.stringify(k)}:</span>{' '}
          <CollapsibleJson
            value={v}
            expanded={expanded}
            setExpanded={setExpanded}
            path={`${path}.${k}`}
          />
        </div>
      ))}
      <span className="mono">{brackets[1]}</span>
    </div>
  );
}

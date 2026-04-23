import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';

type FieldSupport = 'supported' | 'empty_possible' | 'not_supported' | string;

type ProductMatrix = {
  supported?: boolean;
  fields?: Record<string, FieldSupport>;
};

type PlatformEntry = {
  platform: string;
  products: Record<string, ProductMatrix>;
};

type Response =
  | { platforms: PlatformEntry[] }
  | Record<string, Record<string, ProductMatrix>>;

const PRODUCTS = ['identity', 'audience', 'engagement_new', 'stories'];

export default function SupportMatrixPage() {
  const { data, error } = useLive<Response>('/admin/support-matrix', 10000);
  const entries = normalise(data);

  return (
    <AdminLayout title="Support matrix">
      {error && !data && <div className="banner">{error}</div>}

      {entries.length === 0 ? (
        <div className="panel muted">No adapters registered.</div>
      ) : (
        <div className="grid">
          {entries.map((p) => (
            <div key={p.platform} className="panel">
              <div className="panel-title">{p.platform}</div>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Supported</th>
                    <th>Fields</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...PRODUCTS,
                    ...Object.keys(p.products).filter((k) => !PRODUCTS.includes(k)),
                  ].map((prod) => {
                    const m = p.products[prod];
                    return (
                      <tr key={prod}>
                        <td className="mono">{prod}</td>
                        <td>
                          {!m ? (
                            <span className="badge">—</span>
                          ) : m.supported === false ? (
                            <span className="badge danger">no</span>
                          ) : (
                            <span className="badge ok">yes</span>
                          )}
                        </td>
                        <td>
                          {m?.fields ? (
                            <div className="row wrap" style={{ gap: 4 }}>
                              {Object.entries(m.fields).map(([f, s]) => (
                                <span key={f} className={`badge ${toneFor(s)}`} title={s}>
                                  {f} {iconFor(s)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div className="faint" style={{ fontSize: 11, marginTop: 'var(--space-4)' }}>
        ✓ supported · ⚠ empty_possible · — not_supported
      </div>
    </AdminLayout>
  );
}

function iconFor(s: FieldSupport): string {
  if (s === 'supported') return '✓';
  if (s === 'empty_possible') return '⚠';
  if (s === 'not_supported') return '—';
  return '?';
}

function toneFor(s: FieldSupport): string {
  if (s === 'supported') return 'ok';
  if (s === 'empty_possible') return 'warn';
  if (s === 'not_supported') return 'danger';
  return '';
}

function normalise(data: Response | null): PlatformEntry[] {
  if (!data) return [];
  if ('platforms' in data && Array.isArray((data as { platforms: unknown }).platforms)) {
    return (data as { platforms: PlatformEntry[] }).platforms;
  }
  return Object.entries(data as Record<string, Record<string, ProductMatrix>>).map(
    ([platform, products]) => ({ platform, products }),
  );
}

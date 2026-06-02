// Prometheus metrics setup (Week 3 observability).
//
// The org runs a central Grafana/Prometheus/Alertmanager stack that ingests
// metrics via remote_write and already alerts (→ MS Teams) on standard
// prom-client metric names:
//   - http_request_duration_seconds{status_code,...}  (HighErrorRate, HighP95Latency)
//   - nodejs_heap_size_used_bytes / _total_bytes       (NodeJsHeapHigh)
//   - nodejs_eventloop_lag_seconds                      (EventLoopBlocked)
//
// We expose exactly those names so the connector inherits the existing alert
// rules with zero new config. The /metrics endpoint is served on an internal
// ops port (see main.ts) — never routed through Caddy — so it isn't public; a
// metrics agent on the host scrapes it over the private network.

import { collectDefaultMetrics, Histogram, register } from 'prom-client';

let initialised = false;

/**
 * Register the default Node/process metrics on the global registry. Idempotent
 * — safe to call once per process at startup. Gives nodejs_heap_size_*,
 * nodejs_eventloop_lag_seconds, process_cpu_*, etc.
 */
export function initDefaultMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register });
  initialised = true;
}

/**
 * HTTP request histogram. Name + label set match the obs stack's alert rules
 * (HighErrorRate keys on the _count with status_code=~"5..", HighP95Latency on
 * the _bucket). Created on the global registry exactly once at module load.
 */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

/**
 * Collapse a request path to a low-cardinality route label. Numeric ids and
 * long hex/opaque tokens become ':id' so per-account paths don't explode the
 * label space (which would bloat Prometheus + break aggregation).
 */
export function normalizeRoute(path: string): string {
  if (!path) return 'unknown';
  const clean = path.split('?')[0];
  const segments = clean.split('/').map((seg) => {
    if (seg === '') return seg;
    if (/^\d+$/.test(seg)) return ':id';
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
    if (/^c[a-z0-9]{24,}$/i.test(seg)) return ':id'; // cuid
    return seg;
  });
  const joined = segments.join('/') || '/';
  // Cap length defensively.
  return joined.length > 120 ? joined.slice(0, 120) : joined;
}

export { register };

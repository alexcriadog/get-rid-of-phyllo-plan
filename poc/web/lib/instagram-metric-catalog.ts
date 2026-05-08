/**
 * Instagram metric catalog — single source of truth for the labels,
 * descriptions, and provenance metadata shown on every tile in the
 * account dashboard. Phase F of the IG total-coverage rollout.
 *
 * Adding a metric:
 *   1. Add the entry below.
 *   2. Pass `metricKey="<key>"` to <MetricTile />. The component reads
 *      label and tooltip body from this catalog.
 *
 * Keys in this catalog match either:
 *   • canonical fields in `ContentMetrics` / `AccountInsightsData`
 *     (e.g. `reach`, `views`, `accountsEngaged`)
 *   • `metrics.extra` keys (e.g. `ig_reels_avg_watch_time`).
 */

export type MetricSurface =
  | 'account'
  | 'feed'
  | 'reels'
  | 'story'
  | 'video'
  | 'carousel';

export interface MetricDescriptor {
  /** Catalog key — matches the field name in metrics or metrics.extra. */
  key: string;
  /** Display name on the tile. */
  label: string;
  /**
   * One-to-three sentence tooltip body. Should answer: what does this
   * count, what's the time window, and any caveats.
   */
  description: string;
  /**
   * Canonical Meta period for this metric. `lifetime` = vida del
   * contenido / cuenta; `days_28` = ventana de 28 días que arrastra el
   * dashboard de account insights.
   */
  period: 'day' | 'week' | 'days_28' | 'lifetime' | 'total_value' | 'realtime';
  /** Human label for the period — shown verbatim in the tooltip footer. */
  windowSummary: string;
  /** OAuth scope that unlocks this metric. */
  scope: string;
  /** Optional — when Meta added or rebranded the metric. */
  availableSince?: string;
  /** Where this metric makes sense (account-level, per-post type). */
  availableOn: MetricSurface[];
}

const SCOPE_INSIGHTS = 'instagram_manage_insights';
const SCOPE_BASIC = 'instagram_basic';

export const IG_METRICS: MetricDescriptor[] = [
  // === Account-level totals (PanelAccountInsights) ===
  {
    key: 'reach',
    label: 'Alcance',
    description:
      'Cuentas únicas que vieron el contenido al menos una vez. No incluye repeticiones del mismo usuario.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'feed', 'reels', 'story', 'carousel'],
  },
  {
    key: 'views',
    label: 'Visualizaciones',
    description:
      'Veces que se mostró el contenido (suma incluye repeticiones). Reemplaza la métrica antigua "Impressions" — Meta la retiró en v22 (abr 2025).',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableSince: 'Meta v22 (abr 2025)',
    availableOn: ['account', 'feed', 'reels', 'video', 'carousel'],
  },
  {
    key: 'accountsEngaged',
    label: 'Cuentas que interactuaron',
    description:
      'Número único de cuentas que reaccionaron al contenido (likes, comentarios, guardados, comparticiones, respuestas). No suma repeticiones de la misma cuenta.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'totalInteractions',
    label: 'Interacciones totales',
    description:
      'Suma de todas las acciones recibidas: likes, comentarios, guardados, comparticiones, respuestas. Una misma cuenta puede aparecer varias veces.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'feed', 'reels', 'story', 'video', 'carousel'],
  },
  {
    key: 'profileViews',
    label: 'Visitas al perfil',
    description: 'Veces que se cargó la página de perfil de tu cuenta.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'feed', 'story', 'video', 'carousel'],
  },
  {
    key: 'likes',
    label: 'Me gusta',
    description: 'Suma de likes recibidos en el periodo.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'feed', 'reels', 'video', 'carousel'],
  },
  {
    key: 'comments',
    label: 'Comentarios',
    description: 'Suma de comentarios recibidos en el periodo.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'feed', 'reels', 'video', 'carousel'],
  },
  {
    key: 'saves',
    label: 'Guardados',
    description:
      'Veces que un usuario guardó el contenido en sus colecciones. Indicador fuerte de valor para el viewer (más alto = más "vale la pena volver").',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'feed', 'reels', 'video', 'carousel'],
  },
  {
    key: 'shares',
    label: 'Compartidos',
    description:
      'Veces que el contenido fue compartido (a feed propio, DM, otra red). Un share equivale a una recomendación explícita.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'feed', 'reels', 'story', 'video', 'carousel'],
  },
  {
    key: 'replies',
    label: 'Respuestas',
    description:
      'Respuestas directas a Stories vía DM. Solo aplica a Stories — el equivalente de comentarios para contenido efímero.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account', 'story'],
  },
  {
    key: 'websiteClicks',
    label: 'Clicks a la web',
    description: 'Clicks en el enlace del bio que va a tu sitio externo.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'emailContacts',
    label: 'Clicks en email',
    description: 'Clicks en el botón de email del perfil de negocio.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'phoneCallClicks',
    label: 'Clicks en teléfono',
    description: 'Clicks en el botón de llamada del perfil de negocio.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'textMessageClicks',
    label: 'Clicks en SMS',
    description: 'Clicks en el botón de mensaje de texto del perfil.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'getDirectionsClicks',
    label: 'Clicks en cómo llegar',
    description: 'Clicks en el botón de dirección del perfil de negocio.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },

  // === Per-post free fields (Phase B.2 — ride on /media call) ===
  {
    key: 'reposts',
    label: 'Reposts',
    description:
      'Veces que el contenido fue reposteado (re-share que aparece como nueva publicación). Diferente de "shares" — share es enviar el link, repost es publicar como propio.',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: SCOPE_BASIC,
    availableSince: 'Phase B (probe-confirmed v22)',
    availableOn: ['feed', 'reels', 'story'],
  },
  {
    key: 'total_like_count',
    label: 'Me gusta totales (cross-platform)',
    description:
      'Likes contando IG + posts boosteados/anuncios. Útil cuando el mismo creativo se sirvió como ad — incluye los engagements del lado pagado.',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: 'pages_read_engagement',
    availableOn: ['feed', 'reels'],
  },
  {
    key: 'total_comments_count',
    label: 'Comentarios totales (cross-platform)',
    description: 'Comentarios contando IG + posts boosteados/anuncios.',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: 'pages_read_engagement',
    availableOn: ['feed', 'reels'],
  },
  {
    key: 'total_views_count',
    label: 'Visualizaciones totales (cross-platform)',
    description:
      'Views contando IG + posts boosteados/anuncios. Solo aplica a contenido con video (Reels y videos).',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: 'pages_read_engagement',
    availableOn: ['reels', 'video'],
  },

  // === Reels-specific (Phase B.3) ===
  {
    key: 'ig_reels_avg_watch_time',
    label: 'Tiempo de visualización medio',
    description:
      'Tiempo medio (en milisegundos) que cada viewer pasa viendo el Reel. Alto = el contenido retiene atención.',
    period: 'lifetime',
    windowSummary: 'Vida del Reel',
    scope: SCOPE_INSIGHTS,
    availableSince: 'Phase B (probe-confirmed v22)',
    availableOn: ['reels'],
  },
  {
    key: 'ig_reels_video_view_total_time',
    label: 'Tiempo de visualización total',
    description:
      'Suma de tiempo (en milisegundos) que toda la audiencia ha pasado viendo el Reel. Equivale a "horas de atención generadas".',
    period: 'lifetime',
    windowSummary: 'Vida del Reel',
    scope: SCOPE_INSIGHTS,
    availableSince: 'Phase B (probe-confirmed v22)',
    availableOn: ['reels'],
  },
  {
    key: 'reels_skip_rate',
    label: 'Tasa de skip',
    description:
      'Porcentaje de viewers que pasaron el Reel sin verlo entero. Bajo es bueno: la audiencia se queda hasta el final.',
    period: 'lifetime',
    windowSummary: 'Vida del Reel',
    scope: SCOPE_INSIGHTS,
    availableSince: 'Phase B (probe-confirmed v22, en desarrollo según docs)',
    availableOn: ['reels'],
  },
];

const BY_KEY: Map<string, MetricDescriptor> = new Map(
  IG_METRICS.map((m) => [m.key, m]),
);

/**
 * Lookup helper. Returns `undefined` for keys not in the catalog —
 * callers should fall back to a label-only render in that case.
 */
export function lookupMetric(key: string): MetricDescriptor | undefined {
  return BY_KEY.get(key);
}

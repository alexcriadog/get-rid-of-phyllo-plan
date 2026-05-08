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

  // === Account-level "Additional" overflow keys (insights.extra) ===
  {
    key: 'profile_links_taps_total',
    label: 'Clicks en CTAs del perfil (total)',
    description:
      'Suma de clicks en cualquiera de los botones de CTA del perfil de negocio (llamada, SMS, email, dirección, web). Reemplaza las métricas individuales que Meta retiró en v22.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableSince: 'Meta v22 (abr 2025) — reemplaza métricas individuales retiradas',
    availableOn: ['account'],
  },
  {
    key: 'profile_links_taps_call',
    label: 'Clicks en CTA "llamar"',
    description: 'Sub-bucket de profile_links_taps: clicks específicamente en el botón de llamada.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'profile_links_taps_email',
    label: 'Clicks en CTA "email"',
    description: 'Sub-bucket de profile_links_taps: clicks en el botón de email del perfil.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'profile_links_taps_text',
    label: 'Clicks en CTA "SMS"',
    description: 'Sub-bucket de profile_links_taps: clicks en el botón de mensaje de texto.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'profile_links_taps_directions',
    label: 'Clicks en CTA "cómo llegar"',
    description: 'Sub-bucket de profile_links_taps: clicks en el botón de dirección/ubicación.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },
  {
    key: 'profile_links_taps_website',
    label: 'Clicks en CTA "web"',
    description: 'Sub-bucket de profile_links_taps: clicks en el enlace del bio que va a tu sitio externo.',
    period: 'days_28',
    windowSummary: 'Últimos 28 días',
    scope: SCOPE_INSIGHTS,
    availableOn: ['account'],
  },

  // === Per-post insight metrics que viven en metrics.extra (legacy + Phase A) ===
  {
    key: 'follows',
    label: 'Nuevos seguidores',
    description: 'Cuentas que empezaron a seguirte después de ver este contenido.',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: SCOPE_INSIGHTS,
    availableOn: ['feed', 'video', 'carousel', 'story'],
  },
  {
    key: 'profile_visits',
    label: 'Visitas al perfil desde el post',
    description: 'Veces que un viewer abrió tu perfil tras ver este contenido.',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: SCOPE_INSIGHTS,
    availableOn: ['feed', 'video', 'carousel', 'story'],
  },
  {
    key: 'profile_activity',
    label: 'Acciones en el perfil',
    description:
      'Total de interacciones con CTAs del perfil después de ver el post (clicks en bio link, llamada, email, etc.).',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: SCOPE_INSIGHTS,
    availableOn: ['feed', 'story'],
  },
  {
    key: 'profile_activity__bio_link_clicked',
    label: 'Clicks en bio link (post)',
    description: 'Sub-bucket: viewers que clickaron el bio link tras ver este post.',
    period: 'lifetime',
    windowSummary: 'Vida del contenido',
    scope: SCOPE_INSIGHTS,
    availableOn: ['feed', 'story'],
  },
  {
    key: 'navigation',
    label: 'Navegación (Story)',
    description:
      'Total de eventos de navegación durante la story: tap forward, tap back, tap exit, swipe forward.',
    period: 'lifetime',
    windowSummary: 'Vida de la Story',
    scope: SCOPE_INSIGHTS,
    availableOn: ['story'],
  },
  {
    key: 'navigation__tap_forward',
    label: 'Tap forward (Story)',
    description: 'Viewers que avanzaron al siguiente segmento tocando el lado derecho. Bajo es bueno: el contenido retiene atención.',
    period: 'lifetime',
    windowSummary: 'Vida de la Story',
    scope: SCOPE_INSIGHTS,
    availableOn: ['story'],
  },
  {
    key: 'navigation__tap_back',
    label: 'Tap back (Story)',
    description: 'Viewers que retrocedieron al segmento anterior. Alto = el contenido genera interés (quieren re-verlo).',
    period: 'lifetime',
    windowSummary: 'Vida de la Story',
    scope: SCOPE_INSIGHTS,
    availableOn: ['story'],
  },
  {
    key: 'navigation__tap_exit',
    label: 'Tap exit (Story)',
    description: 'Viewers que salieron de las stories tras este segmento. Alto = el contenido los perdió.',
    period: 'lifetime',
    windowSummary: 'Vida de la Story',
    scope: SCOPE_INSIGHTS,
    availableOn: ['story'],
  },
  {
    key: 'navigation__swipe_forward',
    label: 'Swipe forward (Story)',
    description: 'Viewers que deslizaron a la siguiente cuenta saltando tu story entera. Alto = no enganchó.',
    period: 'lifetime',
    windowSummary: 'Vida de la Story',
    scope: SCOPE_INSIGHTS,
    availableOn: ['story'],
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

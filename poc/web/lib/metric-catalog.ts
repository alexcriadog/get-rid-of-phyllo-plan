/**
 * Multi-platform metric catalog — single source of truth for the labels,
 * descriptions, and provenance metadata shown on every tile in the
 * dashboard and the support matrix. Phase F+ of the IG total-coverage
 * rollout, extended to FB / YT / TT / Threads.
 *
 * Adding a metric:
 *   1. Find the platform block below.
 *   2. Append a descriptor with `key` matching either the canonical
 *      `ContentMetrics` / `AccountInsightsData` field or the
 *      `metrics.extra` / support-matrix field name.
 *   3. Pass `metricKey="<key>" platform="<plat>"` to <MetricTile />.
 *
 * Lookup is `(platform, key) → MetricDescriptor | undefined`. When the
 * catalog has no entry for the pair, MetricTile falls back to a
 * label-only render with no tooltip.
 */

export type MetricSurface =
  | 'account'
  | 'feed'
  | 'reels'
  | 'story'
  | 'video'
  | 'carousel';

export interface MetricDescriptor {
  key: string;
  label: string;
  description: string;
  period: 'day' | 'week' | 'days_28' | 'lifetime' | 'total_value' | 'realtime';
  windowSummary: string;
  /** OAuth scope (or platform-specific equivalent) that unlocks this metric. */
  scope: string;
  /** Optional — when the metric was added or rebranded by the platform. */
  availableSince?: string;
  /** Where this metric makes sense (account-level, per-post type). */
  availableOn: MetricSurface[];
}

// ============================================================================
// INSTAGRAM
// ============================================================================

const IG_SCOPE_INSIGHTS = 'instagram_manage_insights';
const IG_SCOPE_BASIC = 'instagram_basic';

const IG_METRICS: MetricDescriptor[] = [
  // Account-level totals (PanelAccountInsights)
  { key: 'reach', label: 'Alcance', description: 'Cuentas únicas que vieron el contenido al menos una vez. No incluye repeticiones del mismo usuario.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'story', 'carousel'] },
  { key: 'views', label: 'Visualizaciones', description: 'Veces que se mostró el contenido (suma incluye repeticiones). Reemplaza la métrica antigua "Impressions" — Meta la retiró en v22 (abr 2025).', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableSince: 'Meta v22 (abr 2025)', availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'accountsEngaged', label: 'Cuentas que interactuaron', description: 'Número único de cuentas que reaccionaron al contenido (likes, comentarios, guardados, comparticiones, respuestas).', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'totalInteractions', label: 'Interacciones totales', description: 'Suma de todas las acciones recibidas: likes, comentarios, guardados, comparticiones, respuestas. Una misma cuenta puede aparecer varias veces.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'profileViews', label: 'Visitas al perfil', description: 'Veces que se cargó la página de perfil de tu cuenta.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'story', 'video', 'carousel'] },
  { key: 'likes', label: 'Me gusta', description: 'Suma de likes recibidos en el periodo.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'comments', label: 'Comentarios', description: 'Suma de comentarios recibidos en el periodo.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'saves', label: 'Guardados', description: 'Veces que un usuario guardó el contenido en sus colecciones. Indicador fuerte de valor para el viewer.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'shares', label: 'Compartidos', description: 'Veces que el contenido fue compartido (a feed propio, DM, otra red). Un share equivale a una recomendación explícita.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'replies', label: 'Respuestas', description: 'Respuestas directas a Stories vía DM. Solo aplica a Stories — equivale a comentarios para contenido efímero.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'story'] },
  { key: 'websiteClicks', label: 'Clicks a la web', description: 'Clicks en el enlace del bio que va a tu sitio externo.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'emailContacts', label: 'Clicks en email', description: 'Clicks en el botón de email del perfil de negocio.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'phoneCallClicks', label: 'Clicks en teléfono', description: 'Clicks en el botón de llamada del perfil de negocio.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'textMessageClicks', label: 'Clicks en SMS', description: 'Clicks en el botón de mensaje de texto del perfil.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'getDirectionsClicks', label: 'Clicks en cómo llegar', description: 'Clicks en el botón de dirección del perfil de negocio.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },

  // Account "Additional" extras
  { key: 'profile_links_taps_total', label: 'Clicks en CTAs del perfil (total)', description: 'Suma de clicks en cualquiera de los botones de CTA del perfil de negocio. Reemplaza las métricas individuales que Meta retiró en v22.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableSince: 'Meta v22 (abr 2025)', availableOn: ['account'] },
  { key: 'profile_links_taps_call', label: 'Clicks en CTA "llamar"', description: 'Sub-bucket de profile_links_taps: clicks en el botón de llamada.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_email', label: 'Clicks en CTA "email"', description: 'Sub-bucket de profile_links_taps: clicks en el botón de email.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_text', label: 'Clicks en CTA "SMS"', description: 'Sub-bucket de profile_links_taps: clicks en el botón de mensaje de texto.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_directions', label: 'Clicks en CTA "cómo llegar"', description: 'Sub-bucket de profile_links_taps: clicks en el botón de dirección/ubicación.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_website', label: 'Clicks en CTA "web"', description: 'Sub-bucket de profile_links_taps: clicks en el enlace del bio.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },

  // Per-post insight metrics (legacy + Phase A)
  { key: 'follows', label: 'Nuevos seguidores', description: 'Cuentas que empezaron a seguirte después de ver este contenido.', period: 'lifetime', windowSummary: 'Vida del contenido', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'carousel', 'story'] },
  { key: 'profile_visits', label: 'Visitas al perfil desde el post', description: 'Veces que un viewer abrió tu perfil tras ver este contenido.', period: 'lifetime', windowSummary: 'Vida del contenido', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'carousel', 'story'] },
  { key: 'profile_activity', label: 'Acciones en el perfil', description: 'Total de interacciones con CTAs del perfil después de ver el post.', period: 'lifetime', windowSummary: 'Vida del contenido', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'story'] },
  { key: 'profile_activity__bio_link_clicked', label: 'Clicks en bio link (post)', description: 'Sub-bucket: viewers que clickaron el bio link tras ver este post.', period: 'lifetime', windowSummary: 'Vida del contenido', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'story'] },
  { key: 'navigation', label: 'Navegación (Story)', description: 'Total de eventos de navegación durante la story: tap forward, tap back, tap exit, swipe forward.', period: 'lifetime', windowSummary: 'Vida de la Story', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__tap_forward', label: 'Tap forward (Story)', description: 'Viewers que avanzaron al siguiente segmento. Bajo es bueno: el contenido retiene atención.', period: 'lifetime', windowSummary: 'Vida de la Story', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__tap_back', label: 'Tap back (Story)', description: 'Viewers que retrocedieron al segmento anterior. Alto = el contenido genera interés.', period: 'lifetime', windowSummary: 'Vida de la Story', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__tap_exit', label: 'Tap exit (Story)', description: 'Viewers que salieron de las stories tras este segmento. Alto = el contenido los perdió.', period: 'lifetime', windowSummary: 'Vida de la Story', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__swipe_forward', label: 'Swipe forward (Story)', description: 'Viewers que deslizaron a la siguiente cuenta saltando tu story entera. Alto = no enganchó.', period: 'lifetime', windowSummary: 'Vida de la Story', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },

  // Per-post free fields (Phase B.2)
  { key: 'reposts', label: 'Reposts', description: 'Veces que el contenido fue reposteado (re-share que aparece como nueva publicación). Diferente de "shares".', period: 'lifetime', windowSummary: 'Vida del contenido', scope: IG_SCOPE_BASIC, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['feed', 'reels', 'story'] },
  { key: 'total_like_count', label: 'Me gusta totales (cross-platform)', description: 'Likes contando IG + posts boosteados/anuncios.', period: 'lifetime', windowSummary: 'Vida del contenido', scope: 'pages_read_engagement', availableOn: ['feed', 'reels'] },
  { key: 'total_comments_count', label: 'Comentarios totales (cross-platform)', description: 'Comentarios contando IG + posts boosteados/anuncios.', period: 'lifetime', windowSummary: 'Vida del contenido', scope: 'pages_read_engagement', availableOn: ['feed', 'reels'] },
  { key: 'total_views_count', label: 'Visualizaciones totales (cross-platform)', description: 'Views contando IG + posts boosteados/anuncios. Solo aplica a contenido video.', period: 'lifetime', windowSummary: 'Vida del contenido', scope: 'pages_read_engagement', availableOn: ['reels', 'video'] },

  // Reels-specific (Phase B.3)
  { key: 'ig_reels_avg_watch_time', label: 'Tiempo de visualización medio', description: 'Tiempo medio (en milisegundos) que cada viewer pasa viendo el Reel. Alto = el contenido retiene atención.', period: 'lifetime', windowSummary: 'Vida del Reel', scope: IG_SCOPE_INSIGHTS, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['reels'] },
  { key: 'ig_reels_video_view_total_time', label: 'Tiempo de visualización total', description: 'Suma de tiempo (en milisegundos) que toda la audiencia ha pasado viendo el Reel. Equivale a "horas de atención generadas".', period: 'lifetime', windowSummary: 'Vida del Reel', scope: IG_SCOPE_INSIGHTS, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['reels'] },
  { key: 'reels_skip_rate', label: 'Tasa de skip', description: 'Porcentaje de viewers que pasaron el Reel sin verlo entero. Bajo es bueno.', period: 'lifetime', windowSummary: 'Vida del Reel', scope: IG_SCOPE_INSIGHTS, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['reels'] },

  // Profile / support-matrix specific
  { key: 'username', label: 'Username', description: 'Handle único del perfil (sin @).', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'displayName', label: 'Nombre de display', description: 'Nombre mostrado en el perfil. Editable.', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'biography', label: 'Bio', description: 'Texto del bio del perfil (hasta 150 chars).', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'URL avatar', description: 'URL de la foto de perfil (CDN de Meta).', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followersCount', label: 'Seguidores', description: 'Total de cuentas que siguen el perfil. ≥100 desbloquea algunas demographics.', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followingCount', label: 'Siguiendo', description: 'Total de cuentas que el perfil sigue.', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'postsCount', label: 'Posts publicados', description: 'Total de posts (carousels, videos, reels incluidos).', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'verified', label: 'Verificado', description: 'Badge azul. Meta no lo expone para IG Business via Graph en v22.', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'accountType', label: 'Tipo de cuenta', description: 'BUSINESS / CREATOR / PERSONAL. Meta lo rechaza cuando la cuenta no está enrolada en Shopping.', period: 'realtime', windowSummary: 'Snapshot actual', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Distribución por género', description: 'Porcentaje de seguidores por género. Requiere ≥100 seguidores.', period: 'lifetime', windowSummary: 'Snapshot lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Distribución por edad', description: 'Buckets (13-17, 18-24, 25-34, ...). Requiere ≥100 seguidores.', period: 'lifetime', windowSummary: 'Snapshot lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Distribución por país', description: 'Top países de la audiencia. Requiere ≥100 seguidores.', period: 'lifetime', windowSummary: 'Snapshot lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'Distribución por ciudad', description: 'Top ciudades. Requiere ≥100 seguidores.', period: 'lifetime', windowSummary: 'Snapshot lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Intereses', description: 'Categorías de interés. No expuesto por Meta para IG.', period: 'lifetime', windowSummary: 'No disponible', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Caption', description: 'Texto del post (hasta 2200 chars).', period: 'realtime', windowSummary: 'Snapshot del post', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'video', 'carousel'] },
  { key: 'permalink', label: 'Permalink', description: 'URL pública del post (forma instagram.com/p/...).', period: 'realtime', windowSummary: 'Snapshot del post', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'mediaUrls', label: 'URLs de medios', description: 'URLs de imágenes/videos del post (CDN). Para carousels, una entrada por slide.', period: 'realtime', windowSummary: 'Snapshot del post', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'publishedAt', label: 'Fecha de publicación', description: 'Timestamp UTC de cuándo se publicó.', period: 'realtime', windowSummary: 'Snapshot del post', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'story', 'video', 'carousel'] },
];

// ============================================================================
// FACEBOOK
// ============================================================================

const FB_SCOPE_INSIGHTS = 'read_insights';
const FB_SCOPE_ENGAGEMENT = 'pages_read_engagement';
const FB_SCOPE_USER_CONTENT = 'pages_read_user_content';
const FB_SCOPE_ADS = 'ads_read';

const FB_METRICS: MetricDescriptor[] = [
  { key: 'name', label: 'Nombre de la página', description: 'Nombre público de la Page.', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'about', label: 'Descripción (about)', description: 'Texto descriptivo en el perfil de la Page.', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'category', label: 'Categoría', description: 'Categoría de la Page (negocio, marca, persona pública, etc.).', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'picture', label: 'Foto de perfil', description: 'URL CDN de la foto de la Page. Refresh periódico requerido.', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'fan_count', label: 'Fans (legacy)', description: 'Total de cuentas que han dado like a la Page (legacy). Meta deprió fan_count en 2024 — usa followers_count.', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'followers_count', label: 'Seguidores', description: 'Total de seguidores de la Page (métrica moderna que reemplaza fan_count).', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'link', label: 'URL de la Page', description: 'URL pública canónica.', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'verified', label: 'Verificado', description: 'Status de verificación de la Page.', period: 'realtime', windowSummary: 'Snapshot actual', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Distribución por género', description: 'Meta retiró page_fans_gender_age en 2024 sin reemplazo público.', period: 'lifetime', windowSummary: 'No disponible', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Distribución por edad', description: 'Meta retiró page_fans_gender_age en 2024 sin reemplazo público.', period: 'lifetime', windowSummary: 'No disponible', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Distribución por país', description: 'Top países de los seguidores vía page_follows_country (reemplazó page_fans_country en 2024).', period: 'lifetime', windowSummary: 'Snapshot lifetime', scope: FB_SCOPE_INSIGHTS, availableSince: 'Meta v22 (2024 rebrand)', availableOn: ['account'] },
  { key: 'cityDistribution', label: 'Distribución por ciudad', description: 'Top ciudades vía page_follows_city.', period: 'lifetime', windowSummary: 'Snapshot lifetime', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Intereses', description: 'No disponible para FB Pages.', period: 'lifetime', windowSummary: 'No disponible', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Texto del post', description: 'Mensaje del post (mentions, links, hashtags).', period: 'realtime', windowSummary: 'Snapshot del post', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
  { key: 'permalink', label: 'Permalink', description: 'URL pública del post (forma facebook.com/<page>/posts/...).', period: 'realtime', windowSummary: 'Snapshot del post', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
  { key: 'mediaUrls', label: 'URLs de medios', description: 'URLs de imágenes/videos del post.', period: 'realtime', windowSummary: 'Snapshot del post', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
  { key: 'likes', label: 'Me gusta', description: 'Reactions positivas (like + love + care + ...) vía post_reactions_by_type_total.', period: 'lifetime', windowSummary: 'Vida del post', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'story'] },
  { key: 'comments', label: 'Comentarios', description: 'Total de comentarios (incluye replies).', period: 'lifetime', windowSummary: 'Vida del post', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'story'] },
  { key: 'shares', label: 'Compartidos', description: 'Veces que el post fue compartido. Indicador fuerte de viralidad.', period: 'lifetime', windowSummary: 'Vida del post', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'story'] },
  { key: 'saves', label: 'Guardados', description: 'No disponible para FB Pages.', period: 'lifetime', windowSummary: 'No disponible', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'impressions', label: 'Impresiones', description: 'Meta retiró post_impressions el 15-Nov-2025. Solo disponible para anuncios pagados via Ads API.', period: 'lifetime', windowSummary: 'Vida del post', scope: FB_SCOPE_INSIGHTS, availableSince: 'Retirada Nov 2025', availableOn: ['feed', 'story'] },
  { key: 'reach', label: 'Alcance', description: 'Usuarios únicos que vieron el post. post_total_media_view_unique reemplaza post_impressions_unique (retirado Jun 2025).', period: 'lifetime', windowSummary: 'Vida del post', scope: FB_SCOPE_INSIGHTS, availableSince: 'Meta v22 (jun 2025)', availableOn: ['feed', 'video', 'story'] },
  { key: 'views', label: 'Visualizaciones', description: 'Veces que se mostró el post (reemplaza "Impressions"). post_media_view.', period: 'lifetime', windowSummary: 'Vida del post', scope: FB_SCOPE_INSIGHTS, availableSince: 'Meta v22 (nov 2025)', availableOn: ['feed', 'video', 'story'] },
  { key: 'replies', label: 'Respuestas (Story)', description: 'Replies a Stories vía pages_fb_story_replies.', period: 'lifetime', windowSummary: 'Vida de la Story', scope: FB_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'ownerHandle', label: 'Autor', description: 'Handle del autor del post mencionado (cuando es de otra Page).', period: 'realtime', windowSummary: 'Snapshot del post', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'text', label: 'Texto', description: 'Contenido del comentario.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'authorDisplayName', label: 'Nombre del autor', description: 'Nombre público de quien comentó.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'authorHandle', label: 'Handle del autor', description: 'Username de quien comentó.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'parentCommentId', label: 'ID del comentario padre', description: 'Si es un reply, ID del comentario al que responde. Permite reconstruir threads.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'rating', label: 'Puntuación', description: 'Estrella o numérico (1-5) que el reviewer dio a la Page.', period: 'realtime', windowSummary: 'Snapshot de la review', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'recommendation_type', label: 'Tipo de recomendación', description: 'positive / negative — si el reviewer recomienda o no la Page.', period: 'realtime', windowSummary: 'Snapshot de la review', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'review_text', label: 'Texto de la review', description: 'Reseña escrita por el reviewer.', period: 'realtime', windowSummary: 'Snapshot de la review', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'reviewer_name', label: 'Nombre del reviewer', description: 'Nombre público de quien escribió la review.', period: 'realtime', windowSummary: 'Snapshot de la review', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'spend', label: 'Inversión', description: 'Gasto total en anuncios (€/$ — currency según ad account).', period: 'lifetime', windowSummary: 'Vida del ad set', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'clicks', label: 'Clicks', description: 'Total de clicks en el anuncio.', period: 'lifetime', windowSummary: 'Vida del ad set', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'ctr', label: 'CTR', description: 'Click-through rate: clicks / impressions × 100. Indicador de relevancia del creativo.', period: 'lifetime', windowSummary: 'Vida del ad set', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'cpm', label: 'CPM', description: 'Coste por mil impresiones. Métrica estándar de eficiencia de inversión.', period: 'lifetime', windowSummary: 'Vida del ad set', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'campaignBreakdown', label: 'Desglose por campaña', description: 'Métricas agrupadas por campaign_id.', period: 'lifetime', windowSummary: 'Vida del ad account', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'recent_posts', label: 'Posts recientes', description: 'Últimos posts de una Page de tercero accesibles via Page Public Content Access.', period: 'realtime', windowSummary: 'Últimos N posts', scope: 'PPCA', availableOn: ['account'] },
  { key: 'publishedAt', label: 'Fecha de publicación', description: 'Timestamp UTC de cuándo se publicó.', period: 'realtime', windowSummary: 'Snapshot del post', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
];

// ============================================================================
// YOUTUBE
// ============================================================================

const YT_SCOPE_DATA = 'youtube.readonly';
const YT_SCOPE_ANALYTICS = 'yt-analytics.readonly';
const YT_SCOPE_MONETARY = 'yt-analytics-monetary.readonly';

const YT_METRICS: MetricDescriptor[] = [
  { key: 'username', label: 'Username (handle)', description: 'Handle de YouTube (forma @creatorname).', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'displayName', label: 'Nombre del canal', description: 'Nombre público mostrado del canal.', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'biography', label: 'Descripción', description: 'Bio del canal (sección "Acerca de").', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'URL avatar', description: 'URL de la foto del canal.', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'profileUrl', label: 'URL del canal', description: 'URL pública canónica (youtube.com/@handle).', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'followersCount', label: 'Suscriptores', description: 'Total de suscriptores. YouTube redondea públicamente, pero la API te da el número exacto al owner.', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'followingCount', label: 'Siguiendo', description: 'YouTube no expone esta métrica vía Data API.', period: 'realtime', windowSummary: 'No disponible', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'postsCount', label: 'Videos publicados', description: 'Total de videos del canal (incluye unlisted que pertenezcan al canal).', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'verified', label: 'Verificado', description: 'YouTube no expone explícitamente este flag vía Data API.', period: 'realtime', windowSummary: 'No disponible', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'accountType', label: 'Tipo de canal', description: 'Tipo de canal (creator, brand, etc.). YouTube no estandariza esto bien.', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'website', label: 'Web', description: 'YouTube no expone una web canónica del canal.', period: 'realtime', windowSummary: 'No disponible', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'category', label: 'Categoría', description: 'Categoría temática del canal (parcialmente expuesta vía topicDetails).', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Distribución por género', description: 'Vía Analytics API metric=viewerPercentage dimensions=ageGroup,gender. Requiere ≥30 días de actividad.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Distribución por edad', description: 'Buckets de edad (13-17, 18-24, 25-34, 35-44, 45-54, 55-64, 65+).', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Distribución por país', description: 'Top países por views vía Analytics API dimensions=country.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'Distribución por ciudad', description: 'Solo disponible en Reporting API (bulk export), no en Analytics API.', period: 'days_28', windowSummary: 'No disponible', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'interests', label: 'Intereses', description: 'YouTube no expone clusters de interés vía API pública.', period: 'lifetime', windowSummary: 'No disponible', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'views', label: 'Visualizaciones', description: 'Total de views en el canal o video.', period: 'days_28', windowSummary: 'Últimos 28 días (account) / Vida (video)', scope: YT_SCOPE_DATA, availableOn: ['account', 'video'] },
  { key: 'likes', label: 'Me gusta', description: 'Total de likes. Google retiró dislikes públicamente en 2021 — solo accesible al owner.', period: 'lifetime', windowSummary: 'Vida del video', scope: YT_SCOPE_DATA, availableOn: ['account', 'video'] },
  { key: 'comments', label: 'Comentarios', description: 'Total de comentarios (incluye replies).', period: 'lifetime', windowSummary: 'Vida del video', scope: YT_SCOPE_DATA, availableOn: ['account', 'video'] },
  { key: 'shares', label: 'Compartidos', description: 'Veces que el video fue compartido fuera de YouTube. Vía Analytics API.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_ANALYTICS, availableOn: ['account', 'video'] },
  { key: 'audienceActivity', label: 'Actividad por hora', description: 'YouTube no expone heatmap de cuándo los viewers están online.', period: 'lifetime', windowSummary: 'No disponible', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'audienceActivityWeekly', label: 'Actividad semanal', description: 'YouTube no expone heatmap 7×24.', period: 'lifetime', windowSummary: 'No disponible', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'revenue', label: 'Ingresos', description: 'Ingresos por monetización (ads + memberships + Super Chat). Solo accesible al owner.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'cpm', label: 'CPM', description: 'Coste por mil impresiones para los anunciantes — gross revenue / 1000 ad impressions.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'monetizedPlaybacks', label: 'Reproducciones monetizadas', description: 'Veces que un ad fue served durante un playback.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'adImpressions', label: 'Impresiones de ads', description: 'Total de ads servidos en videos del canal.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'caption', label: 'Título', description: 'Título del video (hasta 100 chars).', period: 'realtime', windowSummary: 'Snapshot del video', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'permalink', label: 'URL del video', description: 'URL pública (youtube.com/watch?v=...).', period: 'realtime', windowSummary: 'Snapshot del video', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'mediaUrls', label: 'URL del archivo', description: 'YouTube no expone download links — requiere yt-dlp.', period: 'realtime', windowSummary: 'No disponible', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'duration', label: 'Duración', description: 'Duración del video (ISO 8601).', period: 'realtime', windowSummary: 'Snapshot del video', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'isLive', label: 'En directo', description: 'Si el video está en live broadcasting o ya finalizó.', period: 'realtime', windowSummary: 'Snapshot del video', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'privacyStatus', label: 'Privacidad', description: 'public / unlisted / private.', period: 'realtime', windowSummary: 'Snapshot del video', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'madeForKids', label: 'Para niños', description: 'Flag legal COPPA — afecta features (comments, ads, ...).', period: 'realtime', windowSummary: 'Snapshot del video', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'saves', label: 'Guardados', description: 'YouTube no expone saves/playlist adds vía API.', period: 'lifetime', windowSummary: 'No disponible', scope: YT_SCOPE_ANALYTICS, availableOn: ['video'] },
  { key: 'impressions', label: 'Impresiones', description: 'Card impressions vía Analytics API metric=cardImpressions.', period: 'days_28', windowSummary: 'No expuesto hoy', scope: YT_SCOPE_ANALYTICS, availableOn: ['video'] },
  { key: 'reach', label: 'Alcance', description: 'YouTube no expone "reach" como métrica nominativa.', period: 'lifetime', windowSummary: 'No disponible', scope: YT_SCOPE_ANALYTICS, availableOn: ['video'] },
  { key: 'list', label: 'Lista de comentarios', description: 'Threads top-level del video. Paginated vía nextPageToken.', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'threaded', label: 'Threading', description: 'YouTube soporta replies anidados — typing reply a un comment hijo en realidad cuelga del top-level parent.', period: 'realtime', windowSummary: 'Snapshot actual', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'pinned', label: 'Comentario fijado', description: 'YouTube tiene la feature pero la API no la expone públicamente.', period: 'realtime', windowSummary: 'No disponible', scope: YT_SCOPE_DATA, availableOn: ['video'] },
];

// ============================================================================
// TIKTOK
// ============================================================================

const TT_SCOPE_BASIC = 'user.info.basic';
const TT_SCOPE_INSIGHTS = 'video.insights';
const TT_SCOPE_BIZ = 'business.basic';

const TT_METRICS: MetricDescriptor[] = [
  { key: 'username', label: 'Username', description: 'Handle de TikTok (sin @). Estable.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'displayName', label: 'Display name', description: 'Nombre mostrado del perfil.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'biography', label: 'Bio', description: 'Texto del bio del perfil.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'URL avatar', description: 'URL de la foto de perfil. CDN de TikTok.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followersCount', label: 'Seguidores', description: 'Total de seguidores del perfil.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followingCount', label: 'Siguiendo', description: 'Total de cuentas que el perfil sigue.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'postsCount', label: 'Videos publicados', description: 'Total de videos del perfil (lifetime).', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'verified', label: 'Verificado', description: 'Badge de verificación de TikTok.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'accountType', label: 'Tipo de cuenta', description: 'business | null. TikTok distingue Business vs Personal/Creator.', period: 'realtime', windowSummary: 'Snapshot actual', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'likesCount', label: 'Me gusta totales', description: 'Suma de likes en todos los videos del perfil (lifetime).', period: 'lifetime', windowSummary: 'Total lifetime', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Distribución por país', description: 'Top países de la audiencia. Solo populated si la cuenta tiene ≥100 seguidores.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'Distribución por ciudad', description: 'Top ciudades. Mismo threshold ≥100 seguidores.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Distribución por género', description: 'Buckets de género de los seguidores. ≥100 followers requeridos.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Distribución por edad', description: 'Buckets de edad. ≥100 followers.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Intereses', description: 'TikTok no expone interest clusters vía API.', period: 'lifetime', windowSummary: 'No disponible', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'accountInsights', label: 'Insights diarios', description: 'Series diarias de followers, video_views, profile_views, likes, comments, shares, CTAs + heatmap 24h + agregados lifetime.', period: 'days_28', windowSummary: 'Últimos 28 días', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Caption', description: 'Texto del video (hasta 2200 chars en cuentas Business).', period: 'realtime', windowSummary: 'Snapshot del video', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'permalink', label: 'Permalink', description: 'URL pública (tiktok.com/@user/video/...).', period: 'realtime', windowSummary: 'Snapshot del video', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'mediaUrls', label: 'MP4 descargable', description: 'TikTok v1.3 NO expone MP4 descargable vía API.', period: 'realtime', windowSummary: 'No disponible', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'thumbnailUrl', label: 'URL del thumbnail', description: 'Imagen de portada del video.', period: 'realtime', windowSummary: 'Snapshot del video', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'embedUrl', label: 'URL del player', description: 'URL oficial del player embebible.', period: 'realtime', windowSummary: 'Snapshot del video', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'likes', label: 'Me gusta', description: 'Total de likes en el video.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'comments', label: 'Comentarios', description: 'Total de comentarios.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'shares', label: 'Compartidos', description: 'Veces que el video fue compartido (a otra app, link, etc.).', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'saves', label: 'Favoritos', description: 'Veces guardado en favoritos del usuario. TikTok llama a esto "favorites".', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'reach', label: 'Alcance', description: 'Viewers únicos del video.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'views', label: 'Visualizaciones', description: 'Total de plays del video (cuenta repeticiones).', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'videoDuration', label: 'Duración del video', description: 'Longitud del video en segundos.', period: 'realtime', windowSummary: 'Snapshot del video', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'watchTime', label: 'Tiempo de visualización', description: 'total_time_watched + average_time_watched. Indicador clave de retention.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'completionRate', label: 'Tasa de completion', description: 'Porcentaje de viewers que vieron el video entero (full_video_watched_rate).', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'trafficSource', label: 'Fuente de tráfico', description: 'Distribución de cómo llegaron los viewers (For You, Following, Profile, Search, ...).', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'retentionCurve', label: 'Curva de retención', description: 'Porcentaje de viewers viendo el video en cada segundo. Útil para detectar drop-offs.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'likesTimeline', label: 'Timeline de likes', description: 'engagement_likes per segundo. Detecta los momentos donde la audiencia reaccionó.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceCountries', label: 'Países de la audiencia', description: 'Top países de los viewers del video.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceCities', label: 'Ciudades de la audiencia', description: 'Top ciudades de los viewers del video.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceGenders', label: 'Géneros de la audiencia', description: 'Distribución de género de los viewers.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceTypes', label: 'Tipos de audiencia', description: 'Buckets de tipo (followers / non-followers, etc.) según TikTok.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'profileViewsFromPost', label: 'Visitas al perfil desde el post', description: 'Veces que un viewer abrió el perfil tras ver el video.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'newFollowersFromPost', label: 'Nuevos seguidores desde el post', description: 'Cuentas que empezaron a seguir tras ver el video.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'emailClicks', label: 'Clicks en email', description: 'Clicks en el botón de email del perfil de Business.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'phoneNumberClicks', label: 'Clicks en teléfono', description: 'Clicks en el botón de teléfono del perfil de Business.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'addressClicks', label: 'Clicks en dirección', description: 'Clicks en la dirección física del perfil de Business.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'appDownloadClicks', label: 'Clicks en descarga de app', description: 'Clicks en links de App Store / Play Store del perfil.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'leadSubmissions', label: 'Lead form submissions', description: 'Veces que un viewer rellenó un formulario de lead asociado al video.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'websiteClicks', label: 'Clicks a la web', description: 'Clicks en el link del perfil que va al sitio externo.', period: 'lifetime', windowSummary: 'Vida del video', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'impressions', label: 'Impresiones', description: 'TikTok expone reach (viewers únicos) pero NO impressions. Métrica equivalente: views.', period: 'lifetime', windowSummary: 'No disponible', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'text', label: 'Texto', description: 'Contenido del comentario.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'publishedAt', label: 'Publicado el', description: 'Timestamp UTC del comentario o video.', period: 'realtime', windowSummary: 'Snapshot', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'likeCount', label: 'Likes en el comentario', description: 'Veces que otros usuarios dieron like al comentario.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'replyCount', label: 'Replies', description: 'Cantidad de respuestas anidadas.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'pinned', label: 'Fijado', description: 'Si el comentario está pinned por el creator.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'likedByCreator', label: 'Liked por el creator', description: 'Si el comentario tiene corazón puesto por el creator del video.', period: 'realtime', windowSummary: 'Snapshot del comentario', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
];

// ============================================================================
// THREADS
// ============================================================================

const THR_SCOPE_BASIC = 'threads_basic';
const THR_SCOPE_INSIGHTS = 'threads_manage_insights';

const THR_METRICS: MetricDescriptor[] = [
  { key: 'name', label: 'Nombre', description: 'Nombre público del perfil.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'username', label: 'Username', description: 'Handle (sin @). Compartido con Instagram en cuentas linked.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'biography', label: 'Bio', description: 'threads_biography — texto del bio.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'URL avatar', description: 'threads_profile_picture_url.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'profileUrl', label: 'URL del perfil', description: 'Reconstruido como threads.net/@<username>.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'fanCount', label: 'Fans', description: 'Threads no tiene métrica de "fans" — usa followers_count.', period: 'realtime', windowSummary: 'No disponible', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followersCount', label: 'Seguidores', description: 'Total de seguidores. Vía /me/threads_insights metric=followers_count.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'link', label: 'Link', description: 'Link externo del perfil.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'verified', label: 'Verificado', description: 'is_verified — badge de Meta Verified.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Distribución por país', description: 'Threads no expone breakdowns demográficos vía API pública.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'Distribución por ciudad', description: 'No disponible.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Distribución por género', description: 'No disponible.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Distribución por edad', description: 'No disponible.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Intereses', description: 'No disponible.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'views', label: 'Visualizaciones', description: 'Total de views en threads del perfil. Vía /me/threads_insights.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'likes', label: 'Me gusta', description: 'Total de likes en threads del perfil. Lifetime scalar.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'replies', label: 'Respuestas', description: 'Total de replies (concepto de "comentarios" en Threads).', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'reposts', label: 'Reposts', description: 'Total de reposts del perfil.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'quotes', label: 'Quotes', description: 'Total de threads que citaron contenido del perfil.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'followers', label: 'Seguidores (timeline)', description: 'Series temporales de followers. Vía /me/threads_insights con since/until.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Texto', description: 'Texto del thread (`text`). Hasta 500 caracteres.', period: 'realtime', windowSummary: 'Snapshot del thread', scope: THR_SCOPE_BASIC, availableOn: ['feed'] },
  { key: 'permalink', label: 'Permalink', description: 'URL del thread (threads.net/@user/post/...).', period: 'realtime', windowSummary: 'Snapshot del thread', scope: THR_SCOPE_BASIC, availableOn: ['feed'] },
  { key: 'mediaUrls', label: 'URLs de medios', description: 'media_url + carousel children.', period: 'realtime', windowSummary: 'Snapshot del thread', scope: THR_SCOPE_BASIC, availableOn: ['feed'] },
  { key: 'comments', label: 'Comentarios (replies)', description: 'metric=replies. Threads llama a esto "replies".', period: 'lifetime', windowSummary: 'Vida del thread', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'shares', label: 'Compartidos (reposts)', description: 'metric=reposts. Threads no distingue share-as-link de share-as-repost.', period: 'lifetime', windowSummary: 'Vida del thread', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'saves', label: 'Guardados', description: 'Threads no expone saves vía API.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'impressions', label: 'Impresiones', description: 'Threads expone views, no impressions.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'reach', label: 'Alcance', description: 'Threads no expone reach como métrica nominativa.', period: 'lifetime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'list', label: 'Lista de replies', description: 'Threads expone replies vía /{thread_id}/replies. Soporta paginación.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'threaded', label: 'Threading', description: 'Threads soporta replies anidados.', period: 'realtime', windowSummary: 'Snapshot actual', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'pinned', label: 'Comentario fijado', description: 'Threads tiene la feature pero la API no la expone.', period: 'realtime', windowSummary: 'No disponible', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'metrics', label: 'Métricas de mention', description: 'Métricas asociadas al thread donde te mencionaron.', period: 'lifetime', windowSummary: 'Vida del thread', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
];

// ============================================================================
// LOOKUP
// ============================================================================

const CATALOGS: Record<string, MetricDescriptor[]> = {
  instagram: IG_METRICS,
  facebook: FB_METRICS,
  youtube: YT_METRICS,
  tiktok: TT_METRICS,
  threads: THR_METRICS,
};

const BY_PLATFORM: Record<string, Map<string, MetricDescriptor>> =
  Object.fromEntries(
    Object.entries(CATALOGS).map(([plat, list]) => [
      plat,
      new Map(list.map((m) => [m.key, m])),
    ]),
  );

/**
 * Lookup descriptor for a (platform, key) pair. Returns `undefined` when the
 * platform isn't in the catalog or the key isn't catalogued — callers should
 * fall back to a label-only render in that case.
 */
export function lookupMetric(
  platform: string | undefined,
  key: string,
): MetricDescriptor | undefined {
  if (!platform) return undefined;
  return BY_PLATFORM[platform]?.get(key);
}

/** Re-exported for callers that want to enumerate a platform's catalog. */
export const PLATFORM_METRICS = CATALOGS;

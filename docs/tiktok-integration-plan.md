# TikTok Integration — Capability Study & Implementation Plan

**Status:** Plan, ready to execute
**Last updated:** 2026-04-28
**Audience:** engineer doing the implementation, tech lead reviewing
**Companions:** [`platform-refactor.md`](platform-refactor.md), [`07-platforms/tiktok.md`](07-platforms/tiktok.md), [`scalability-plan.md`](scalability-plan.md)
**Scope:** translate the granted TikTok Business API permissions into a concrete set of products, endpoint coverage, canonical-type extensions, and a build plan that mirrors the just-finished Meta-shared / `*-api/` decomposition pattern.

---

## TL;DR

- Tienes acceso al **Organic API** de TikTok (no solo Marketing). Las permissions checked en los screenshots — `TikTok Accounts`, `Mentions`, `Reporting`, `Measurement`, `Ad Account Management` — habilitan lectura organic + parte ad-side. Para creator analytics, **lo que importa es `TikTok Accounts` + `Mentions`**.
- TikTok Business API y TikTok Display API son **dos surfaces distintas**. La Business API at `business-api.tiktok.com/open_api/v1.3/` es la que vas a usar. La Display API at `open.tiktokapis.com/v2/` (la que el doc previo `tiktok.md` referencia) es para flows OAuth de creator personal — no aplica con los scopes que tienes.
- Comparado con Meta: TikTok Business da **menos demografías** pero **mejores métricas de video** (watch time, completion rate, reach by source, audience countries). Cubre identity / audience / engagement bien, **stories no existe**, **lives sí pero limitado**.
- Architectura: replicate el patrón de `meta-graph/` como `tiktok-api/` shared core (HTTP chokepoint, auth Bearer, cursor paging, error classifier, raw archive). Per-platform módulo `tiktok/` con `TikTokRateLimitStrategy`, support matrix, types, fetchers, mappers. **Nuevo product type propuesto: `comments`** (TikTok lo expone first-class; Meta no en este PoC).
- 3-4 días de trabajo siguiendo el patrón Meta. Cero abstracción nueva — solo composición lateral.

---

## 1. Permissions granted — análisis literal de tus screenshots

### Checked (toda la familia)

| Permission group | Habilita |
|---|---|
| **TikTok Accounts** (All) | Lectura organic de TikTok Business Accounts: profile, videos, video insights, follower demographics, engaged audience demographics |
| **Mentions** (All) | Posts donde la cuenta business fue @-mencionada por otros creators |
| **Reporting** (All) | Reports sync + async — primarily ad-side, también para video performance históricos via `report/integrated/get` |
| **Measurement** (All) | Server-side events (Conversions API, Pixels, Offline Events). **No relevante** para connector organic |
| **Ad Account Management** (All) | Lista de advertisers, balance, transacciones, Pangle blocklists, Business Center. **No relevante** para connector organic |

### Not checked (capabilities futuras opcionales)

| Permission | Qué unlockearía si la activas |
|---|---|
| **TikTok Creator** | API de Creator Marketplace — read perfiles de creators con stats |
| **TikTok Creator Marketplace (TCM)** | Acceso a TCM data — discovery de creators |
| **Audience Management** | Upload de custom audiences — irrelevante for organic |
| **Creative Management** | Upload de creative assets para ads — irrelevante |
| **Ad Comments** | Comments en ads (no en posts orgánicos) |
| **Pixel Management** | Web pixel events |
| **Brand Safety** | Whitelist/blacklist content categories — ad-side |
| **Partner Insights** | Whitelisted partner program data |

**Decisión:** Phase 1 usa solo `TikTok Accounts` + `Mentions`. Reporting puede entrar en Phase 2 si necesitamos históricos profundos. El resto out of scope.

---

## 2. TikTok APIs — el mapa que no aparece claro en su docs

TikTok tiene **tres** API products que la gente confunde:

| API | Base URL | Auth | Para qué |
|---|---|---|---|
| **Display API v2** | `open.tiktokapis.com/v2/` | OAuth user (consumer) | Apps con login "Sign in with TikTok" → leen contenido del usuario logged-in |
| **Business API — Organic** | `business-api.tiktok.com/open_api/v1.3/` con `business_id` | OAuth Business Center | Lo que tú tienes. Lee Business Accounts management |
| **Business API — Marketing** | mismo base, `advertiser_id` | mismo OAuth | Ads, campaigns, audiences (no relevante aquí) |

**Lo que vas a integrar = Business API — Organic** subset:
- `TikTok Accounts` permission group (organic content)
- `Mentions` permission group

El existing `docs/07-platforms/tiktok.md` describe la **Display API v2**. Es información parcialmente reutilizable (los `fields` del video object son similares) pero el endpoint base, auth, y rate-limit model son **otros**. Lo actualizamos en Phase 1.

---

## 3. Endpoint catalog — Organic API (TikTok Accounts + Mentions)

> **Nota.** TikTok no publica una matriz exhaustiva de todos los fields que cada endpoint acepta — varía por permission tier y por la review aprobada. La tabla siguiente es la superficie típica documentada en v1.3 + lo observado en SDK + prior arts (Sprinklr / Hootsuite / Phyllo). Cualquier endpoint que falle en review se confirma al implementar.

### 3.1 Business Account info

```
GET https://business-api.tiktok.com/open_api/v1.3/business/get/
?business_id=<bid>&fields=["display_name","profile_image","username","is_verified","followers_count","following_count","likes_count","video_count","audience_countries","audience_genders"]
```

**Headers:** `Access-Token: <token>`

**Returns:**

| Field | Tipo | Notas |
|---|---|---|
| `business_id` | string | id estable per business |
| `display_name` | string | el nombre visible |
| `username` | string | el `@handle` |
| `profile_image` | string url | avatar |
| `is_verified` | bool | verified badge |
| `followers_count` | int | total followers |
| `following_count` | int | a quien sigue la cuenta |
| `likes_count` | int | total likes acumulados |
| `video_count` | int | total videos publicados |
| `audience_countries` | array<{country, percentage}> | demografía por país (top N) |
| `audience_genders` | array<{gender, percentage}> | demografía gender |

> Maps cleanly a `ProfileData` + parte de `AudienceData`.

### 3.2 Video list (organic)

```
GET https://business-api.tiktok.com/open_api/v1.3/business/video/list/
?business_id=<bid>&cursor=<int>&max_count=20
&fields=["item_id","create_time","thumbnail_url","share_url","embed_url","caption","video_views","likes","comments","shares","reach","video_duration","full_video_url"]
```

**Pagination:** cursor-based (`cursor` param + `has_more` in response).

**Returns per item:**

| Field | Maps a `ContentData.*` |
|---|---|
| `item_id` | `platformContentId` |
| `caption` | `caption` |
| `create_time` (unix s) | `publishedAt` |
| `share_url` | `permalink` |
| `embed_url` / `embed_html` | `metrics.extra.embed_url` (no canonical) |
| `thumbnail_url` | `thumbnailUrl` |
| `full_video_url` | `mediaUrls[0]` (cuando esté disponible) |
| `video_duration` (s) | `metrics.extra.video_duration_s` |
| `video_views` | `metrics.views` |
| `likes` | `metrics.likes` |
| `comments` | `metrics.comments` |
| `shares` | `metrics.shares` |
| `reach` | `metrics.reach` |

> **Tipo `contentType`:** TikTok solo tiene `video`. Stories/lives son separadas (más abajo).

### 3.3 Video insights (per-video)

```
GET https://business-api.tiktok.com/open_api/v1.3/business/video/get/
?business_id=<bid>&video_id=<id>
&fields=["video_views","reach","likes","comments","shares","saves","profile_visits","engaged_audience_demographics","total_play_time","average_watch_time","completion_rate","traffic_source"]
```

**Métricas TikTok-específicas (no en Meta):**

| Field | Significado |
|---|---|
| `total_play_time` (s) | watch time agregado del video |
| `average_watch_time` (s) | mediana / promedio per viewer |
| `completion_rate` (%) | % de viewers que llegaron al final |
| `traffic_source` | `{For You: %, Personal Profile: %, Hashtag: %, Sound: %, Search: %, Other: %}` — distribución de DÓNDE vino el view |
| `audience_countries` | top countries per video |
| `audience_genders` | gender split per video |

> **Esto es oro vs Meta.** Watch time y completion rate son métricas que Meta NO expone para Reels. Traffic source diferencia "viral en For You" vs "fans" — tu engineering analytics lo va a querer.

### 3.4 Comments

```
GET /open_api/v1.3/business/comment/list/
?business_id=<bid>&video_id=<vid>&cursor=<int>&max_count=20

GET /open_api/v1.3/business/comment/reply/list/
?business_id=<bid>&comment_id=<cid>&cursor=<int>

POST /open_api/v1.3/business/comment/reply/create/
{ business_id, video_id, comment_id, text }

POST /open_api/v1.3/business/comment/like/
{ business_id, comment_id, action: "like"|"unlike" }

POST /open_api/v1.3/business/comment/hide/
{ business_id, comment_id, action: "hide"|"unhide" }
```

**Comment fields:**

| Field | Tipo |
|---|---|
| `comment_id` | string |
| `video_id` | string |
| `text` | string |
| `create_time` | unix s |
| `like_count` | int |
| `reply_count` | int |
| `username` | string |
| `display_name` | string |
| `is_owner` | bool (si la business account hizo el comment) |
| `liked_by_creator` | bool |
| `pinned` | bool |

> **Esto justifica un nuevo product type `comments`.** Meta no lo expone vía la port surface canónica hoy; TikTok sí, y Twitch / YouTube / X lo expondrán también.

### 3.5 Mentions

```
GET /open_api/v1.3/business/mention/list/
?business_id=<bid>&cursor=<int>&max_count=20
&fields=["item_id","caption","create_time","username","display_name","video_views","likes","comments","shares"]
```

**Returns:** lista de videos donde otros creators han usado `@yourbusinessaccount` en su caption o pasado tu sticker.

> Justifica nuevo product `mentions`.

### 3.6 Hashtag info

```
GET /open_api/v1.3/business/hashtag/get/
?business_id=<bid>&hashtag_name=<#tag>
```

**Returns:** `{name, view_count, video_count, is_commerce}`. Útil para analytics pero no es per-account — es global hashtag stats. **No lo modelamos como product** — lo dejamos como un endpoint admin opcional.

---

## 4. Mapping a tipos canónicos

Cruzo todo lo de §3 contra el current `platform-types.ts`:

### `ProfileData` (sin cambios necesarios)

```
business.username     → username
business.display_name → displayName
business.profile_image→ avatarUrl
business.followers    → followersCount
business.following    → followingCount
business.video_count  → postsCount
business.is_verified  → verified
business.likes_count  → metrics.extra.lifetime_likes (NEW: extender ProfileData con extra?)
```

**Decisión:** añadir `ProfileData.extra?: Record<string, number|string>` para `lifetime_likes`, `bio_link`, etc. que cada plataforma expone diferente. Patrón ya familiar.

### `AudienceData` (extender)

TikTok da:
- `audience_countries` (account-level + per-video) → existing `countryDistribution`
- `audience_genders` (account-level + per-video) → existing `genderDistribution`
- `audience_age_groups` (cuando hay ≥100 followers activos) → existing `ageDistribution`

Stuff TikTok no da (que sí da Meta):
- City breakdown — no expuesto vía Business API
- Engagement-source demographics — no expuesto a este nivel

**Decisión:** sin cambios de tipo. Las ausencias se reflejan en `INSTAGRAM_SUPPORT_MATRIX` (perdón, `TIKTOK_SUPPORT_MATRIX`) marcando `cityDistribution: 'not_supported'`.

### `ContentData.metrics` (extender via `extra`)

TikTok-specific metrics que NO existen en `ContentMetrics`:

- `total_play_time` → `metrics.extra.total_play_time_s`
- `average_watch_time` → `metrics.extra.avg_watch_time_s`
- `completion_rate` → `metrics.extra.completion_rate_pct`
- `traffic_source.*` → `metrics.extra.traffic_for_you_pct`, `metrics.extra.traffic_hashtag_pct`, etc.
- `video_duration` → `metrics.extra.video_duration_s`
- `saves` → `metrics.saves` (ya existe)

**Decisión:** sin cambios de tipo. `extra` absorbe.

### Nuevos product types necesarios

| Product type | Origen | ¿Existe en Meta? | Prioridad |
|---|---|---|---|
| `identity` | mismo | sí | reuse |
| `audience` | mismo | sí | reuse |
| `engagement_new` | TikTok video list + per-video insights | sí | reuse |
| `comments` ⭐ | TikTok `/business/comment/list/` (per-video) | NO en port hoy | **add** |
| `mentions` ⭐ | TikTok `/business/mention/list/` | NO | **add** |
| `stories` | n/a TikTok | sí (Meta) | TikTok marca `not_supported` |

**Cambios requeridos en port + scheduler + worker:**

1. `platform-adapter.port.ts`: añadir métodos opcionales:
   ```typescript
   fetchComments?(accessToken, canonicalId, contentId, opts?, metadata?): Promise<CommentData[]>;
   fetchMentions?(accessToken, canonicalId, opts?, metadata?): Promise<ContentData[]>;
   ```
2. `platform-types.ts`: nuevo `CommentData`:
   ```typescript
   export interface CommentData {
     platformCommentId: string;
     platformContentId: string;        // qué post/video
     parentCommentId?: string;          // si es reply
     authorHandle: string | null;
     authorDisplayName: string | null;
     text: string;
     publishedAt: Date | null;
     fetchedAt: Date;
     metrics: { likes?: number; replies?: number };
     pinned?: boolean;
     likedByCreator?: boolean;
     rawResponse: { collection: string; contentHash: string };
   }
   ```
   `Mentions` reusa `ContentData` (un mention IS un video).
3. `sync.worker.ts:dispatchFetch`: añadir cases `'comments'` y `'mentions'` con conditional capability check (`if (!adapter.fetchComments) return null` etc.).
4. `cadences` table seed: añadir defaults — `comments` cada 1h por video activo (últimos 30 días), `mentions` cada 6h.

---

## 5. TikTok Business API — particularidades que no son Meta

### 5.1 OAuth flow

```
1. Authorization URL:
   https://business-api.tiktok.com/portal/auth?app_id=<appid>&redirect_uri=<r>&state=<s>
2. Callback con `auth_code` + `state` + `business_id` (cuando user elige una BC).
3. Token exchange:
   POST https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/
   { app_id, secret, auth_code }
   → { access_token, refresh_token, expires_in, scope, advertiser_ids[] }
4. Lista de Business Accounts disponibles:
   GET /open_api/v1.3/oauth2/advertiser/get/
   → en realidad lista advertisers Y business accounts (depende del scope).
```

**Diferencias críticas vs Meta:**
- **Auth header**, no `?access_token=...` query param. El chokepoint cambia.
- **`business_id` es requerido** en casi cada llamada. No es como Meta donde el `canonicalId` va en la URL — TikTok lo manda como query param.
- **Refresh tokens rotan**. Cada respuesta puede traer un nuevo `refresh_token`; el adapter debe almacenarlo (no asumir el viejo sigue válido).

### 5.2 Rate limits

| Scope | Cap documentado | Reset |
|---|---|---|
| Per app + per access_token | 10 calls/sec (sliding) | 1s |
| Per access_token + per endpoint | depende del endpoint, 100-1000/day típico | 24h UTC |
| Some endpoints (research-tier) | quota separada por proyecto | 24h |

**No hay header** `x-app-usage` equivalente. TikTok responde **429** con `Retry-After` cuando excedes. Strategy debe modelar:

- `tiktok:app:qps` — sliding 1s window of N (typical 10).
- `tiktok:user_token:daily:{hash}:YYYY-MM-DD` — daily counter, resets at UTC midnight.
- Quizás `tiktok:business:daily:{business_id}:YYYY-MM-DD` — per business daily.

Esto implica **`RateLimitStrategy` mejor de lo que hoy hace `meta-graph`**. Meta solo usa `token-bucket`. TikTok requiere `daily-counter` (que el `RateLimitHint.strategy` ya soporta pero ningún consumer ha usado todavía).

### 5.3 Error envelope

TikTok responses:
```json
{
  "code": 0,             // 0 = success, !=0 = error
  "message": "OK",
  "request_id": "...",
  "data": { ... }
}
```

**HTTP 200 NO significa success.** Siempre hay que verificar `code === 0`. Errores comunes:
- `code: 40001` — invalid params
- `code: 40100` — token expired
- `code: 40105` — quota exceeded
- `code: 40000` — generic

Esto rompe el assumption del `BoundGraphClient` que mapea por status. **`TikTokClient` necesita su propia status mapping** que mira `body.code` además de `response.status`.

### 5.4 Token lifecycle

- Access token: **24 horas** (vs Meta's "long-lived" ~60 días).
- Refresh token: **365 días** (vs Meta sin refresh formal).
- Refresh job **es obligatorio** — sin él, una cuenta deja de syncar al día siguiente.

Esto valida la urgencia de **D3 (token refresh job)** del scalability plan que está pendiente. Antes de TikTok productivo, el job ya tiene que correr.

---

## 6. Architecture — `tiktok-api/` shared core

Replica del patrón Meta. Mismas capas: chokepoint compartido + per-platform módulo.

### 6.1 File tree objetivo

```
poc/src/modules/platforms/shared/
  tiktok-api/
    index.ts                                          barrel
    tiktok-client.ts                          ~200    chokepoint (Bearer auth + cursor paging)
    tiktok-types.ts                           ~80     TikTokListResponse, TikTokVideo, TikTokComment, TikTokMention
    tiktok-paging.ts                          ~40     cursor walker (no URLs como Meta)
    tiktok-errors.ts                          ~80     classifyByCode (40001, 40100, 40105...) + isQuotaError
    tiktok-context.ts                         ~50     buildContext: tokenHash, businessId
    tiktok-raw-archive.ts                     ~50     persistRaw (reuse pattern)
    tiktok-rate-limit-strategy.port.ts        ~30     idéntico al Meta port
    tiktok-api.module.ts                      ~30

poc/src/modules/platforms/tiktok/
  tiktok.module.ts                            ~40     Nest wiring
  tiktok.adapter.ts                           ~120    facade — implements PlatformAdapter
  tiktok.constants.ts                         ~20     DEFAULT_PAGE_SIZE = 20 (TikTok cap)
  tiktok.support-matrix.ts                    ~80     stories/cityDistribution/saves: not_supported
  tiktok.rate-limit.strategy.ts               ~60     QPS app + daily user_token + daily business_id
  tiktok.types.ts                             ~120    business-side types
  tiktok.context.ts                           ~30     buildTikTokContext
  tiktok.tokens.ts                            ~5      TIKTOK_API_CLIENT symbol
  fetcher/
    tiktok-profile.fetcher.ts                 ~80
    tiktok-audience.fetcher.ts                ~120    (limited: countries+genders+ages, no city)
    tiktok-content.fetcher.ts                 ~200    list + per-video insights enrichment
    tiktok-comments.fetcher.ts                ~150    NEW capability — paginated per video
    tiktok-mentions.fetcher.ts                ~100    NEW capability
  mapper/
    tiktok-video.mapper.ts                    ~120    videoToContent + extractVideoMetrics
    tiktok-comment.mapper.ts                  ~80     commentToCommentData
    tiktok-audience.mapper.ts                 ~70     parseAudienceCountries, parseAudienceGenders
```

**Total estimado: 16 ficheros, todos < 200 líneas, ninguno cerca de los ceilings.**

### 6.2 Contratos (los que difieren de Meta)

#### `TikTokClient.call<T>(opts)`

```typescript
interface TikTokCallOpts {
  endpoint: string;                                  // p.ej '/business/video/list/'
  method: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accessToken: string;
  context: PlatformAdapterContext & { businessId: string };
  accountId?: bigint;
}
```

Body de la implementación:
1. Acquire rate buckets via inyectada `TikTokRateLimitStrategy`.
2. HTTP call (GET → query string; POST → JSON body) con header `Access-Token: <token>`.
3. Persist raw BEFORE checking `body.code` (D1 fix análogo).
4. Parse `{code, message, data}`:
   - `code === 0` → return `data as T`
   - `code === 40100` → throw `TokenRevokedError`
   - `code === 40105` → throw `RateLimitedError(resetInMs = retry-after)`
   - cualquier otro `!== 0` → throw `AdapterFetchError(message)`
5. Si HTTP status === 429 (raro pero posible) → mismo `RateLimitedError`.

#### `TikTokRateLimitStrategy.hints()`

```typescript
@Injectable()
export class TikTokRateLimitStrategy implements RateLimitStrategy {
  hints(ctx: PlatformAdapterContext & { businessId?: string }): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      { scope: 'qps_app',
        keyTemplate: 'rate:tt:qps_app',
        capacity: 10, refillPerMs: 10/1000, costPerCall: 1,
        strategy: 'token-bucket' },
      { scope: 'daily_user',
        keyTemplate: 'rate:tt:daily_user:{hash}:{YYYY-MM-DD-UTC}',
        capacity: 1000, refillPerMs: 0, costPerCall: 1,
        strategy: 'daily-counter' },
    ];
    if (ctx.businessId) {
      hints.push({ scope: 'daily_business',
        keyTemplate: 'rate:tt:daily_business:{business_id}:{YYYY-MM-DD-UTC}',
        capacity: 5000, refillPerMs: 0, costPerCall: 1,
        strategy: 'daily-counter' });
    }
    return hints;
  }
}
```

> El template `{YYYY-MM-DD-UTC}` ya está soportado por `RateBucketService.interpolate`. Solo hay que pasar `business_id` en el `acquireCtx`.

> **Heads up**: el Lua del rate-bucket actualmente solo refilla via `tokens + elapsed * refill`. Para `strategy: 'daily-counter'` con `refillPerMs: 0`, el bucket simplemente nunca se rellena dentro del día — la "renovación" ocurre porque la key cambia al cruzar UTC midnight. Eso ya funciona; verified mentally.

---

## 7. Plan de implementación — fases

### Phase F0 — Token refresh job *(0.5 días, blocker)*

Antes de TikTok productivo. Sin él una cuenta TikTok deja de syncar al día siguiente.

- `oauth-refresh.worker.ts` (nuevo) — cron diario que llama `refreshIfNeeded(account)`.
- Per-platform refresh: Meta por ahora no-op (sus tokens no expiran formalmente), TikTok refresh via `/oauth2/access_token/?grant_type=refresh_token`.
- **Update `oauth_tokens.expires_at`** consistentemente. Hoy `lastRefreshedAt` existe pero no se honra.
- Si refresh falla → `account.status = 'needs_reauth'` + emit `account.needs_reauth` event.

**Implícito**: cierra D3 del scalability plan.

### Phase F1 — `tiktok-api/` shared core *(1 día)*

Espejo de `meta-graph/`:

1. `tiktok-types.ts`, `tiktok-paging.ts`, `tiktok-context.ts`, `tiktok-errors.ts`, `tiktok-raw-archive.ts`
2. `tiktok-rate-limit-strategy.port.ts`
3. `tiktok-client.ts` con `TikTokClient.bind(strategy).call()`
4. `tiktok-api.module.ts`
5. Pinning tests con fixtures sintetizadas (3-4 endpoints) — comments, video list, mentions

### Phase F2 — Port + worker extension para `comments` + `mentions` *(0.5 días)*

1. `platform-types.ts`: añadir `CommentData`.
2. `platform-adapter.port.ts`: añadir `fetchComments?` y `fetchMentions?` opcionales.
3. `sync.worker.ts:dispatchFetch`: cases nuevos + capability check (`if !adapter.fetchComments → null` para que la cuenta no busy-loop).
4. Schema MySQL: añadir `comments` y `mentions` valores válidos en `sync_jobs.product` enum (si lo es) y nuevas filas en `cadences` table seed.
5. Mongo: nuevos collections `comments` (independiente de `posts` por shape distinto) y reusar `posts` para mentions (son videos).

### Phase F3 — TikTok adapter facade + 5 fetchers + 3 mappers *(1.5 días)*

Replica del patrón FB/IG:

1. `tiktok.constants.ts`, `tiktok.support-matrix.ts`, `tiktok.types.ts`, `tiktok.context.ts`, `tiktok.tokens.ts`
2. `tiktok.rate-limit.strategy.ts`
3. `mapper/tiktok-video.mapper.ts`, `mapper/tiktok-comment.mapper.ts`, `mapper/tiktok-audience.mapper.ts`
4. `fetcher/tiktok-profile.fetcher.ts` — usa `/business/get/`
5. `fetcher/tiktok-audience.fetcher.ts` — usa el mismo `/business/get/` (audience embebida) + `/business/audience/get/` si existe quota
6. `fetcher/tiktok-content.fetcher.ts` — `/business/video/list/` + per-video `/business/video/get/` enrichment
7. `fetcher/tiktok-comments.fetcher.ts` — paginated por video
8. `fetcher/tiktok-mentions.fetcher.ts`
9. `tiktok.adapter.ts` (facade ~120 líneas)
10. `tiktok.module.ts` — DI wiring + `TIKTOK_API_CLIENT` factory
11. Registrar `TikTokAdapter` en `PlatformsModule.ADAPTER_REGISTRY` con key `'tiktok'`.

### Phase F4 — Smoke test contra producción *(0.5 días)*

Mismo modus operandi que el smoke test Meta:

1. Add 1 cuenta TikTok Business via OAuth flow (manual seed).
2. Lanzar worker; encolar `identity` solo. Verificar `body.code === 0`, raw archive con httpStatus 200.
3. Si OK → `audience` (cuenta cuenta countries + genders).
4. Si OK → `engagement_new` con `max_count=5` (no 20) — limitar blast radius.
5. Si OK → `comments` para 1 video.
6. Si OK → `mentions`.

Mata al primer 429 o 40105 (quota exceeded). Las cuotas TikTok son daily, así que un mal sweep te bloquea hasta el siguiente UTC midnight.

### Phase F5 — Docs + ADR *(0.5 días)*

1. Update `docs/07-platforms/tiktok.md` para reflejar Business API (no Display).
2. Add `docs/adr/0014-tiktok-business-api-integration.md`.
3. Update `docs/03-extensibility.md` con el patrón `tiktok-api/` como ejemplo de cómo añadir más platform families.
4. Update `docs/04-data-model.md` con `comments` collection schema.

**Total estimado:** 4 engineer-days. Mejor que los 7 que el plan original asumía gracias al patrón ya establecido.

---

## 8. Decisiones que necesitan tu OK

1. **¿`comments` es product first-class hoy?** Implica:
   - Per-account, per-video — un sync_job por (account, 'comments') pero la implementación itera sobre los últimos N videos del account.
   - Mongo collection separada `comments` con índice `{account_id, platform_content_id, platform_comment_id}`.
   - Admin UI sin cambios para Phase 1; solo el connector ingiere.

   Recomendación: SÍ. Si TikTok lo da gratis, no encola los datos hoy y es retrabajo mañana.

2. **¿`mentions` es product?** Igual razonamiento. Recomendación: SÍ.

3. **¿`reporting` (reports históricos vía Reporting API)?** Da retroactiva por días. Useful pero pesado (calls de 30 days × N videos). **Recomendación: Phase 2**, fuera de scope inicial.

4. **¿Webhooks TikTok?** TikTok expone webhooks para video publish, content moderation, etc. Cubre menos que Meta. **Recomendación: postpone** — polling es suficiente para Phase 1 (igual que el doc actual lo indica).

5. **`canonicalId` para TikTok = `business_id`** o `open_id`? Te recomiendo `business_id` porque:
   - Es único por Business Center.
   - `open_id` cambia per app (no lo es).
   - Todos los endpoints organic toman `business_id` como query param.

   El `accounts.canonical_user_id` field guarda string — coincide.

6. **OAuth flow del backend-api existente.** Hoy backend-api hace el OAuth con TikAPI (third-party). Pasar a OAuth oficial implica:
   - Nuevo redirect URI registrado en tu TikTok app.
   - User reconnects sus cuentas TikTok via flow oficial.
   - TikAPI sigue para video download URLs (irrelevante para connector).

   **No es scope del connector**. Es backend-api task.

---

## 9. Riesgos + mitigaciones

| Riesgo | Mitigación |
|---|---|
| TikTok review cycle por scope (3-7 días) | Tu app ya tiene los scopes aprobados según los screenshots. Riesgo bajo. |
| Quota daily se agota en pruebas | `max_count=5`, `engagement_new` con max 5 videos en smoke; ratesweeps fuera de horario peak. |
| Ban de la app por abuso | El chokepoint comparte rate buckets via Redis (post-refactor). 10 QPS app cap evita bursts. |
| Comments/mentions tienen quotas separadas | Sí — los dos tienen su propio daily counter en general (~500/day). Para 100 cuentas a 1h cadence, 100 calls/h × 24 = 2400 — excede. **Decisión: cadence comments = 6h, mentions = 12h** en Phase 1. |
| TikTok cambia API entre versiones | Versionar el base URL (`v1.3` → `v1.4`) en `tiktok-client.ts` const. Single source of truth. |
| Refresh token expira sin renovar antes (365d edge) | Cron diario detecta `expires_at < now + 30d` y forza refresh proactivo. |

---

## 10. Métricas/datos finales que vamos a obtener

Tabla resumen para CEO / product:

| Categoría | Métrica | Disponible en TikTok | Comparable Meta IG |
|---|---|:---:|:---:|
| Profile | Follower count | ✅ | ✅ |
| Profile | Following count | ✅ | ✅ |
| Profile | Total likes accumulated | ✅ | ❌ |
| Profile | Verified | ✅ | ❌ (Meta IG retiró) |
| Profile | Account category/business type | ✅ | ✅ |
| Audience | Country distribution | ✅ | ✅ |
| Audience | Gender distribution | ✅ | ✅ |
| Audience | Age distribution | ✅ | ✅ |
| Audience | City distribution | ❌ | ✅ |
| Audience | Reached vs Engaged demographics | ⚠️ partial | ✅ |
| Audience | Active hours/days heatmap | ⚠️ via reporting | ❌ |
| Engagement (per video) | Views | ✅ | ✅ (via Reels insights) |
| Engagement (per video) | Likes/comments/shares | ✅ | ✅ |
| Engagement (per video) | Saves | ⚠️ partial | ✅ |
| Engagement (per video) | Reach | ✅ | ✅ |
| Engagement (per video) | **Watch time / completion rate** | ✅ | ❌ |
| Engagement (per video) | **Traffic source breakdown** (For You vs hashtag vs profile) | ✅ | ❌ |
| Engagement (per video) | Profile visits attributable | ✅ | ✅ |
| Comments | Full thread con replies | ✅ | ⚠️ (no en port hoy) |
| Comments | Like / hide / pin metadata | ✅ | ✅ |
| Mentions | Posts mencionando la cuenta | ✅ | ❌ (Meta requiere webhook subscription) |
| Stories | n/a | ❌ | ✅ |
| Lives | Limited | ⚠️ | ❌ |
| Hashtag analytics | Global (no per account) | ✅ | ⚠️ via search |

**Conclusión:** TikTok te da **dos categorías nuevas que Meta no expone hoy** (watch time + traffic source) y **dos productos nuevos** (comments first-class, mentions). Pierde stories y city demographics. Para creator analytics es **NET WIN** vs Meta.

---

## 11. Decisiones tomadas (2026-04-28)

1. **`canonical_user_id` = `open_id`** (estable; lo usa backend-api para correlar webhooks de TikTok). El `business_id` (requerido por la Business API en cada call) se almacena en `accounts.metadata.business_id`. Mismo patrón que Meta usa para `metadata.page_id`. Los TikTok fetchers lo leen vía `extractBusinessId(metadata)` análogo a `extractAccountId`.

2. **`comments` + `mentions` como product types desde Phase 1.** Implica añadir `CommentData` al port + métodos opcionales `fetchComments?` / `fetchMentions?` + cases en `sync.worker.ts:dispatchFetch` con capability check.

3. **Cadences finales TikTok** (escalables, conservadoras):

   | Product | Cadence | Justificación |
   |---|---|---|
   | `identity` | 1h | barato (1 call/cuenta) |
   | `audience` | **24h (1 día)** | demographics cambian lentamente |
   | `engagement_new` | **2h** | balance frescura vs quota |
   | `comments` | **12h** | barato per-video pero N videos × M comments puede crecer rápido |
   | `mentions` | 12h | volumen bajo per-account |
   | `stories` | n/a | TikTok no expone — `not_supported` en support matrix |

4. **Cuentas TikTok seedeadas manualmente desde admin console.** No hay que construir el OAuth flow en este sprint. El adapter asume que `oauth_tokens.access_token_ciphertext` y `accounts.metadata.business_id` ya existen cuando llega el sync. Si faltan → `AdapterFetchError("missing business_id in metadata")` con guidance text.

---

## 12. Execution log

*(Append here as F0 → F5 happen.)*

### F0 — Token refresh job — pending

### F1 — Shared `tiktok-api/` core — done (2026-04-29)

- Built `tiktok-client.ts` (246 LOC) as the single chokepoint with `Access-Token` header, GET/POST, JSON-array `fields=` query param, raw archive write *before* any throw, numeric `code` envelope check.
- Types: `TikTokV13Envelope`, `TikTokBusinessAccount`, `TikTokVideo` (`item_id`, `caption`, `create_time` is **string** not number), `TikTokComment`, `TikTokMention`.
- Errors: numeric `code` mapping — `40100/40104` → `TokenRevokedError`, `40105` → `RateLimitedError`. Generic envelope failure → `AdapterFetchError`.
- Context: `business_id` resolved from `Account.metadata.business_id` with fallback to `metadata.open_id` (the Business-Center account-holder OAuth flow returns `open_id` and we reuse it).

### F2 — Adapter + fetchers — done (2026-04-29)

- 102-LOC facade `TikTokAdapter` registered as `'tiktok'` in `ADAPTER_REGISTRY`.
- 5 fetchers: profile / audience / content / comments / mentions, each owning its own field whitelist + cursor pagination.
- `fetchMentions` left as a no-op (returns `[]`) pending live shape probe — `/business/mention/list/` returns `code=40006 "no schema found"` for every documented payload variant we tried.
- Support matrix updated to reflect v1.3 reality: `postsCount: not_supported`, `watchTime: not_supported`, per-video insights endpoint does not exist for our scopes.

### F3 — Rate limit strategy — done (2026-04-29)

- `qps_app` (10/s) + `daily_user_token` (1000/d) + `daily_business` (5000/d).
- Same Lua-backed `RateBucketService` Meta uses; no platform-specific worker code.

### F4 — Live smoke test against Camaleonic prod — done (2026-04-29)

Account 6, sync_jobs 20–24, single-product enqueue at a time:

| product         | sync_job | calls (200) | result                                                                                                            |
|-----------------|----------|-------------|-------------------------------------------------------------------------------------------------------------------|
| identity        | 20       | 1           | profile persisted (display_name, followers, bio, avatar). `code=0`.                                              |
| audience        | 22       | 1           | demographics + `accountInsights.followerCountSeries` from `account.metrics`. `code=0`.                            |
| engagement_new  | 23       | 2           | 25 posts persisted (paginated). `video_duration_s` survives in `metrics.extra`. `code=0`.                         |
| comments        | 24       | 1 + 10      | 11/11 `code=0`, all `comments_in_resp=0` — Camaleonic posts have no public comments (expected).                    |
| mentions        | 21       | —           | not enqueued; endpoint shape probe pending.                                                                       |

#### Bugs found and fixed during F4

1. **Worker dropped `business_id`**: the worker built a context object with only `tokenHash/pageId/channelId/accountId`, throwing away the rest of `Account.metadata` so the TikTok adapter couldn't resolve `business_id`. Fix: spread `metadata` first into the context before layering worker-derived fields (`sync.worker.ts` ~L216).
2. **Display API v2 vs Business API v1.3 confusion**: initial implementation built against `/v2/user/info/` (Display API, requires `client_key/client_secret`-mode token). Pivoted back to v1.3 once live probes confirmed `/business/get/`, `/business/video/list/`, `/business/comment/list/` all accept the BC account-holder token via the `Access-Token` header. Support matrix and field whitelists rewritten to match v1.3 reality (no `reach`, no `total_play_time`, no `traffic_source` — those are v2-only / scope-gated).
3. **Comments `max_count` cap**: TikTok caps `/business/comment/list/` `max_count` at 30. We were sending 50 → 10/10 calls returned `code=40002 "max_count: number must be most 30"`. Worse, the per-video try/catch in `tiktok-comments.fetcher.ts` swallowed every failure at debug level, so the worker logged the sync as a clean success with 0 comments. Fix: introduce `COMMENTS_MAX_PER_PAGE = 30`, clamp `max_count: Math.min(perVideo, COMMENTS_MAX_PER_PAGE)`, and add a warn-level log when *every* video in a sync fails with the same error so systemic param mismatches stop hiding behind per-video resilience.

### F5 — Mentions probe — pending

- `/business/mention/list/` rejects every documented payload with `code=40006 "no schema found"`. Need either a fresh look at the v1.3 "Mentions" doc page or to drop mentions for now and revisit when TikTok publishes a working schema.

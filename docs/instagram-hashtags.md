# Instagram hashtag tracking — explainer y decisión pendiente

> **Estado**: backlog (post-v1). Este doc existe para que decidamos en
> sesión futura si lo implementamos y bajo qué arquitectura. **No hay
> código en producción que use hashtags.** Lo único que toca esto en el
> repo es la mención en el plan v1 (`~/.claude/plans/lively-watching-hippo.md`)
> y este propio doc.

---

## TL;DR

- Meta expone una API para **buscar contenido público que use un hashtag dado** (`#NikeAirMax`, `#ElClásico`, etc.). Es feature de **descubrimiento / social listening**, no de tracking de cuentas propias.
- **Cap duro no negociable**: máximo **30 hashtags únicos por cuenta IG cada 7 días rolling**. Si lo blow, Meta rechaza con `(#10) Application does not have permission for this action` hasta que el window roll over.
- **Solo funciona con FB Login** (la cuenta IG Business tiene que estar linked a un FB Page). En IG Direct OAuth no está disponible.
- Implementación estimada: **3-5 días** (schema migration + fetcher + UI de gestión + Redis budget tracker + cron).
- **No requiere App Review** — usa el scope `instagram_basic` que ya tenemos.

---

## ¿Para qué sirve hashtag tracking?

Cuando una cuenta IG Business hace `/ig_hashtag_search?q=ElClásico`, Meta devuelve un `hashtag_id` global (ej: `17841440048929892`). Con ese ID puedes pedir:

- **`/{hashtag_id}/top_media`** — los 50 posts más populares con ese hashtag (sorted by Meta's relevance score, mezcla likes + comments + recencia).
- **`/{hashtag_id}/recent_media`** — los 50 posts más recientes con ese hashtag (timeline cronológico).

Por cada post devuelto obtienes los mismos fields que en `/{ig-user}/media` para tu propio contenido (id, caption, media_url, permalink, timestamp, like_count, comments_count, etc.) **excepto que NO puedes pedir insights** (no eres el owner). Es contenido público de **otras cuentas**.

### Casos de uso reales

1. **Social listening de marca**: tracking de `#NikeAirMax` para ver qué creators están publicando contenido orgánico relacionado con productos de Nike, sin que sean ads pagadas.
2. **Sponsorship discovery**: saber qué cuentas usan hashtags como `#patrocinadopor[BRAND]` o `#paidpartnership` con un brand específico — útil para nuestro flow de Camaleonic Analytics (descubrir creators sponsored).
3. **Competitive analysis**: ver el contenido que los competidores publican bajo hashtags compartidos (`#ElClásico` durante la jornada).
4. **Trend tracking**: medir el volumen / velocity de un hashtag estacional (`#BlackFriday2026`).

### Lo que NO sirve

- **Tracking de tus propias cuentas**: para tu cuenta usas `/{ig-user}/media` (gratis, sin cap).
- **Hashtags privados** o stories: no se exponen aquí.
- **Texto libre / búsqueda full-text**: solo hashtags exactos.
- **Analytics de hashtag**: no devuelve métricas agregadas tipo "cuántos posts/día".

---

## El cap de Meta — 30 / 7d / IG-user

Meta tiene un **límite duro** que aplica al token (no a tu app):

> **30 unique hashtag IDs queried per IG Business account, in a rolling 7-day window.**

Detalles que nos pueden morder:

- Cada **`hashtag_id` único** cuenta. Si haces `ig_hashtag_search?q=Nike` 100 veces en un día, **cuenta como 1** (Meta cachea el ID, todas resuelven al mismo). Si haces 30 búsquedas distintas (Nike, Adidas, Reebok, …), llegaste al cap.
- El window es **rolling**, no calendar-week. Si registraste un hashtag a las 14:00 del lunes, ese slot se libera el lunes siguiente a las 14:00.
- **No hay forma de aumentarlo.** No es BUC, no es per-app — es una restricción dura de Meta para prevenir scraping masivo.
- Si lo excedes: Meta devuelve `(#10) Application does not have permission for this action`. **NO** rate-limited 429 — es 400. Y no se rinde hasta que el slot más viejo expire en el rolling window.

**Implicación arquitectónica**: necesitamos un **budget tracker per-account** que rechace nuevas hashtag adds cuando ya hay 30 IDs activos en los últimos 7 días.

---

## Arquitectura propuesta (pendiente de aprobación)

### Schema (Prisma)

Nueva tabla `instagram_tracked_hashtags`:

```prisma
model InstagramTrackedHashtag {
  id              BigInt   @id @default(autoincrement())
  account_id      BigInt
  hashtag         String   // bare text sin '#'
  hashtag_id      String?  // Meta's id, cacheado tras primera resolución
  cadence         String   @default("daily")  // 'daily' | 'paused'
  created_at      DateTime @default(now())
  last_synced_at  DateTime?
  account         Account  @relation(fields: [account_id], references: [id])
  @@unique([account_id, hashtag])
  @@index([account_id])
}
```

- `hashtag_id` se cachea para no gastar slots resolviendo el mismo nombre.
- `cadence` permite pausar un hashtag sin borrarlo (mantener histórico, parar fetch).

### Fetcher

`poc/src/modules/platforms/instagram/fetcher/instagram-hashtag.fetcher.ts` — nuevo, con dos fases:

1. **Resolución**: si `tracked_hashtag.hashtag_id IS NULL`, llamar `/ig_hashtag_search?user_id=<ig>&q=<hashtag>` y persistir `hashtag_id`. Esto **gasta 1 slot**.
2. **Fetch**: por cada `hashtag_id`, llamar `/{hashtag_id}/top_media?user_id=<ig>&fields=...` y `/{hashtag_id}/recent_media?user_id=<ig>&fields=...`. Pagina hasta 50 posts por endpoint.

Output a Mongo `posts` collection con un nuevo discriminador:

```ts
{
  account_id: '2',
  source: 'hashtag',          // nuevo (hoy todos son 'owned' implícito)
  hashtagSource: 'ElClasico',
  platform_content_id: '...',
  data: { /* mismo shape que owned ContentData */ },
}
```

Indexar `(account_id, source, hashtagSource)` para que la UI los muestre en una tab separada del feed propio.

### Budget tracker (Redis)

ZSET con timestamp por miembro, TTL 7 días:

```
KEY:   ig:hashtag-budget:<account_id>
TYPE:  ZSET
SCORE: timestamp millis del momento de uso del slot
MEMBER: <hashtag_id>
```

Pseudocódigo del fetcher:

```ts
async function ensureBudget(accountId, hashtagId) {
  // Limpia slots > 7d viejos antes de chequear el cap
  const cutoff = Date.now() - 7 * 86_400_000;
  await redis.zremrangebyscore(`ig:hashtag-budget:${accountId}`, '-inf', cutoff);

  const inBudget = await redis.zscore(`ig:hashtag-budget:${accountId}`, hashtagId);
  if (inBudget) return; // ya está dentro del slot, refresh score

  const count = await redis.zcard(`ig:hashtag-budget:${accountId}`);
  if (count >= 30) throw new HashtagBudgetExhaustedError();

  await redis.zadd(`ig:hashtag-budget:${accountId}`, Date.now(), hashtagId);
}
```

ZSET por encima de SET con per-member TTL: el primero permite eviction time-based atómica con `zremrangebyscore`, el segundo no (Redis no tiene per-member TTL nativo en SETs).

### Cadencia (cron)

Hashtags son **costosos**: 2 calls × 30 hashtags × N accounts = potencial scaling pain. Por eso:

- **No corre per-sync** (que es cada 6h en el resto de productos). Demasiadas calls.
- Corre **una vez al día** vía cron dedicado: `IG_HASHTAG_DAILY` job en `sync.scheduler.ts`.
- Itera accounts con `tracked_hashtags.cadence='daily'`, ranquea por `last_synced_at ASC` (los más viejos primero), y ejecuta hasta agotar budget o pillar a todos.

### UI de gestión

`poc/web/pages/account/[id]/hashtags.tsx` — nueva tab en el dashboard de cuenta:

- Tabla: hashtag, last_synced_at (RelativeTime), cadence (badge), botón "Quitar".
- Form para añadir hashtag — input + botón.
- Header con counter: **`12 / 30 hashtags activos en los últimos 7 días`**. Lee del Redis budget. Si full, deshabilita el botón add con tooltip "Cap de Meta alcanzado, próximo slot libre el [fecha + 7d]".

### Feature flag

Env var `IG_FEATURE_HASHTAGS=on|off`. Default `off` para v1. Solo se enciende cuando confirmamos que la implementación es estable y queremos pagar el coste de calls.

---

## Solo FB Login — incompatible con IG Direct

El endpoint `/ig_hashtag_search` y los `/hashtag_id/*` requieren explícitamente:

- **FB Login** (la cuenta IG tiene que estar linked a un FB Page).
- Scope **`instagram_basic`** (ya lo tenemos).
- Token **Page-level**, no User-level.

En **IG Direct OAuth** (Phase D del plan, pendiente), Meta NO expone hashtag search. Las cuentas que se conecten via Direct verán la tab `/hashtags` deshabilitada con un mensaje "Disponible solo en cuentas conectadas via Facebook" o se ocultará entirely.

El `instagram.support-matrix.ts` necesitará un eje `is_ig_direct` para gating (ya estaba en el plan Phase D para hashtags + ads).

---

## Riesgos y trade-offs

| Riesgo | Mitigación |
|---|---|
| Excedemos el cap por bug en el budget tracker | Redis ZSET con cleanup atómico + test que verifica 31º add devuelve error sin pegar a Meta |
| Un hashtag muy poblado spammea Mongo (50 + 50 posts/día = 100 posts/hashtag/día = 36500 al año) | Retention policy: borrar hashtag-source posts >90 días |
| Coste de calls explota con 100 cuentas × 30 hashtags × 2 calls = 6000 calls/día | Es soportable (Meta BUC max ~200 points/h por token, 2x60x24=2880/h potencial — bien dentro). Pero monitor en `/admin/rate-limits` con `product='ig_hashtag'` |
| Resolver el mismo hashtag en N accounts consume N slots | Acepta — Meta lo cachea **per IG user**, no global. No hay shortcut. |
| Hashtag deletion mid-window devuelve `#100` | Try/catch + setear `hashtag_id=null`, reintentar resolución la próxima vez |

---

## Decisiones que tendremos que tomar

Cuando entremos en una sesión para implementar esto, decidir:

1. **Default hashtags al conectar una cuenta**: ¿pre-poblamos con algo (`#<account.handle>`)? ¿O empezamos vacío y el operator añade manualmente?
2. **Output channel**: posts en la collection `posts` con `source='hashtag'` (mi propuesta) o collection separada `hashtag_posts`? La primera permite reuso del UI feed; la segunda evita pollution de queries de owned content.
3. **Top vs Recent**: ¿pulleamos ambos o solo uno? Top da relevance, Recent da timeline. Mi propuesta: ambos, como dos sub-products.
4. **Multi-account hashtag dedup**: si dos cuentas trackean `#ElClásico`, ¿hacemos una sola call y compartimos posts? **NO** — Meta requiere `user_id` en los params, los posts pueden diferir por audiencia. Cada cuenta su slot.
5. **Public UI exposure**: ¿enseñamos los hashtag-source posts en `/account/<id>/feed` también, o solo en `/hashtags`? Probable: solo en `/hashtags` para no diluir el feed propio.
6. **Bordes**: hashtags con caracteres especiales, emojis, longitud > 100 chars — Meta tiene reglas que iremos descubriendo on the fly.

---

## Effort breakdown

| Pieza | Effort |
|---|---|
| Prisma migration + model | XS (30 min) |
| Fetcher con resolución + budget Redis | M (1 d) |
| Cron daily + sync.scheduler integration | S (3 h) |
| Admin/public UI tab `/hashtags` | M (1 d) |
| Budget counter + add/remove flow | S (4 h) |
| Tests (mapper, budget logic, integration) | S (4 h) |
| Soporte support-matrix para `is_ig_direct=true` (deshabilita) | XS (30 min) |
| **Total** | **~3-5 d** |

Sin dependencias externas: no App Review, no Meta business verification, no schema upstream. Solo nuestra infra.

---

## Referencias oficiales

- [Hashtag Search API](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search)
- [IG Hashtag Node](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag)
- [`top_media` edge](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/top_media)
- [`recent_media` edge](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/recent_media)

---

**Cuando estés listo para implementar esto**, dile a Claude algo tipo "hashtags now" y arrancamos con Prisma migration + fetcher.

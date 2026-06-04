# Estudio: superficie completa de Meta (FB-Login vs IG-Login) y encaje arquitectónico

> **Fecha**: 2026-06-04 · **Origen**: pregunta de diseño tras shippear IG-direct —
> "si añadimos TODO lo que Meta proporciona, ¿aguanta la Opción A (una sola
> plataforma `instagram` + `metadata.oauth_flow`) o deberíamos haber hecho
> `instagram_direct` como plataforma separada (visible en support matrix, etc.)?"
>
> Inventarios verificados contra developers.facebook.com el 2026-06-04 (dos
> pasadas independientes, una por superficie). Donde la doc estaba caída o
> ambigua se marca ⚠️.

---

## 1. Matriz de capacidades completa (estado 2026)

| Capacidad | FB-Login (`graph.facebook.com`, Page token) | IG-Login (`graph.instagram.com`, IG user token) |
|---|---|---|
| **Perfil / identity** | ✅ (campos extra: `shopping_product_tag_eligibility`, `alt_text`, `ig_id`) | ✅ (⚠️ ver §3: la doc lista `is_published`/`has_profile_pic`/`legacy_instagram_user_id` pero en producción los rechaza) |
| **Media (posts/reels/carousels)** | ✅ + campos limited-access (`boost_*`, `legacy_instagram_media_id`, `total_*_count`, `collaborators`, `product_tags`) | ✅ (campos core idénticos) |
| **Media insights** | ✅ (+ `total_comments/likes/views`) | ✅ (mismas métricas core; `total_*` ausentes) |
| **Account insights + demografía** | ✅ | ✅ (mismas familias de métricas, mismos breakdowns/timeframes, mismo mínimo 100 followers) |
| **Stories + `story_insights` webhook** | ✅ | ✅ |
| **Comments (read/reply/hide/delete)** | ✅ (`instagram_manage_comments`) | ✅ (`instagram_business_manage_comments`) |
| **Mentions & tagged media** | ✅ (`/tags`, `/mentioned_media`, webhook `mentions`) | ✅ ⚠️ — la doc actual lista los edges `mentions`/`mentioned_media`/`mentioned_comment`/`tags` y el webhook en IG-Login. **Nuestro explainer de mayo (§3) está desactualizado aquí** — decía que se perdían |
| **DMs / Messaging** | ✅ vía **Messenger Platform** (Page token, host FB, webhooks de Page) | ✅ **nativo** (`POST /me/messages` en graph.instagram.com, quick replies, ice breakers, human agent 7d, conversations API) |
| **Content publishing** | ✅ (+ product tags 20/post 30/reel, + paid-partnership label) | ✅ (100 posts/24h, carousels, reels, stories; **sin** shopping tags) |
| **Hashtag search** (`ig_hashtag_search`, top/recent media) | ✅ **SOLO AQUÍ** (30 hashtags/7d, Platform Rate Limits) | ❌ |
| **Business discovery** (consultar otras cuentas públicas) | ✅ **SOLO AQUÍ** | ❌ |
| **Product tagging / IG Shopping** (`available_catalogs`, `catalog_product_search`…) | ✅ **SOLO AQUÍ** | ❌ (doc explícita: "Shopping tags are not supported") |
| **Partnership ads / branded content / boost** | ✅ **SOLO AQUÍ** (`boost_eligibility_info`, `boost_ads_list`) | ❌ |
| **Puente Marketing API** (`legacy_instagram_*_id`, `authorized_adaccounts`, `ads_read`) | ✅ **SOLO AQUÍ** | ❌ |
| **Collabs** | ✅ (`collaborative_media`, edge `collaborators`) | ⚠️ parcial (`collaboration_invites` sí; edges de media marcados FB-only) |
| **Webhooks — entrega** | Page `subscribed_apps` (requiere `pages_manage_metadata`) | App-level en dashboard + `POST /me/subscribed_apps` en graph.instagram.com (sin Page) |
| **Token** | Page token, NO refrescable (re-auth al expirar) | User token 60d, refrescable indefinidamente (`ig_refresh_token`) |
| **Rate limits** | BUC `4800 × impressions/24h` por (app, IG user); hashtag/discovery van por Platform Limits | BUC misma fórmula; messaging con límites propios (2/s conversations, 100/s send) |
| **Página de Facebook requerida** | SÍ | NO ← la razón de existir del flow |
| **App Review** | familia `instagram_*` + `pages_*` | familia `instagram_business_*` (5 scopes); Advanced Access para operar cuentas de terceros |

**Lectura clave**: las superficies han CONVERGIDO mucho desde nuestro explainer de
mayo. Mentions/tags ya están en IG-Login, los DMs son incluso *mejores* en
IG-Login (nativos, sin Messenger Platform). Lo exclusivo de FB-Login se reduce a
un clúster coherente: **descubrimiento público (hashtags, business discovery) +
comercio (shopping) + ads (partnership/boost/Marketing API)** — todo lo que
requiere el grafo de negocio de Facebook, no la cuenta IG en sí.

## 2. Cómo encaja TODO en la arquitectura actual (Opción A)

Clasificando cada capacidad futura en tres cubos:

### Cubo A — productos flow-agnósticos (≈70% de la superficie)
identity, audience, content+insights, stories, comments, mentions/tags,
publishing básico. Mismos endpoints en ambos hosts; las diferencias son de
**campos/métricas sueltos**.

**Encaje**: el que ya tenemos. Support matrix intacta; deltas a nivel de
fetcher con el patrón `profileFieldsFor` (constantes por flow). Cero fricción.

### Cubo B — mismo producto, fontanería distinta (DMs, private replies, webhook subscribe)
La capacidad existe en ambos flows pero la implementación diverge de verdad:
Messenger Platform con Page token vs API nativa de IG-Login (hosts, endpoints,
webhooks y límites distintos).

**Encaje**: UNA plataforma y UN producto (`messages`) en la matriz, pero
internamente un **puerto con dos estrategias** (`IgMessagingClient` →
`FbLoginMessaging` / `IgDirectMessaging`), elegida por `oauth_flow` en el
módulo, NO con `if (isIgDirect)` esparcidos por los fetchers. Es el mismo
patrón que ya usamos para el host (`graphBaseUrl` se decide en UN sitio).
Regla: **cada capacidad del cubo B = un strategy object, nunca if-scattering.**

### Cubo C — productos FB-only (hashtags, business discovery, shopping, partnership ads, ads bridge)
Solo existen en un flow. Aquí es donde la pregunta "¿no deberíamos verlo en la
support matrix?" tiene razón — **pero como eje, no como plataforma**:

```ts
// instagram.support-matrix.ts — evolución prevista (cuando llegue el 1er producto C)
{
  product: 'hashtags',
  flows: ['fb_login'],          // ausente = ['fb_login', 'ig_direct']
  fields: [...],
}
```

Y la misma anotación en `PLATFORM_CATALOG` para que el connect-tool y el
catálogo la propaguen: una cuenta IG-direct que intente enrolar `hashtags`
recibe `product_not_available_for_flow` y la UI ofrece el CTA "reconecta vía
Facebook" (que, como demostramos hoy, convierte la fila sin duplicar).

## 3. Doc de Meta vs realidad: por qué los probes mandan

La referencia IG User de Meta lista `is_published`, `has_profile_pic` y
`legacy_instagram_user_id` como legibles en IG-Login — y producción los rechaza
con `IGApiException code 100` (incidente 2026-06-04, fix `307c536`). La doc de
Meta y su gateway no siempre coinciden, en ambas direcciones.

**Regla operativa**: ninguna capacidad se da por disponible en un flow hasta
probarla contra esa superficie con un token real de ese flow (el patrón "probe"
que ya usamos en Phase B). La matriz de §1 es el mapa; el territorio se verifica
al implementar cada producto.

## 4. Stress test: ¿aguanta la Opción A a máxima anchura?

Inventario de puntos de branching por flow si implementáramos TODO:

| Punto | Tipo | Estado |
|---|---|---|
| Host del Graph (`graphBaseUrl`) | gate local existente | ✅ ya |
| Ciclo de token (refresh vs re-auth) | gate local existente | ✅ ya |
| `normalizeMetaToken` skip | gate local existente | ✅ ya |
| Field/metric deltas por fetcher | constantes por flow (patrón `profileFieldsFor`) | ✅ patrón fijado |
| Webhook subscribe (Page vs app-level/me) | gate existente + 1 rama futura para `/me/subscribed_apps` | ✅/➕ |
| Eje `flows` en support matrix + catálogo | 1 cambio estructural, una vez | ➕ al primer producto C |
| Messaging (y cada cubo-B futuro) | strategy object por capacidad | ➕ al implementar DMs |
| BUC app-key por superficie | segregación en BucTelemetryService | ➕ ya identificado como follow-up |

Total: ~8 puntos, todos **locales y nombrados**, frente a duplicar el ~70% del
módulo (cubo A) que es idéntico. Y la Opción B seguiría sin resolver lo más
caro (cubo B): el messaging FB-login vs IG-login divergiría igual *dentro* de
cada plataforma duplicada.

**El argumento decisivo sigue siendo la identidad**: el IG Business User ID es
el mismo en ambos flows (verificado hoy en producción: el upsert dedupeó). Con
plataformas separadas, la misma cuenta de Instagram serían dos filas, dos
historiales de métricas, dos webhook endpoints para el cliente — y una
migración de datos el día que quisiéramos unificarlas.

## 5. Tripwires — cuándo reevaluar hacia plataforma separada

Reabrir esta decisión si ocurre cualquiera de:

1. **>10 gates `isIgDirect` sueltos** fuera de strategy objects (señal de
   if-scattering — el coste que la Opción B sí elimina).
2. **Meta divergiera las superficies** en vez de converger (hoy la tendencia es
   la contraria: scopes `instagram_business_*` unificados en 2025, mentions/DMs
   ya portados a IG-Login; FB-Login va camino de quedar como la superficie
   "negocio/ads/comercio").
3. **Producto quisiera VENDER los flows como SKUs distintos** (pricing o
   dashboards separados por flow) — entonces la separación dejaría de ser
   técnica y pasaría a ser de dominio.
4. **Una migración masiva de cuentas a IG-direct** convirtiera FB-login en
   legacy minoritario — en ese caso el flip es barato: borrar el flag, no
   migrar schema (ventaja diseñada de la Opción A).

## 6. Plan de encaje por producto futuro (resumen accionable)

| Producto futuro | Cubo | Qué tocar |
|---|---|---|
| Comments (moderación) | A | catálogo (+scope mapping ya existe para `_manage_comments`), fetcher único |
| Mentions / tagged (UGC) | A | edges idénticos en ambos hosts — fetcher único + probe en ambas superficies |
| Publishing | A | fetcher único; gate de product-tags por flow (param-level, no producto) |
| DMs | **B** | `IgMessagingClient` strategy (2 impls) + webhooks fields por flow + scope `_manage_messages` (App Review + business verification) |
| Hashtag tracking | **C** | primer uso del eje `flows` en matrix+catálogo; Platform Rate Limits (bucket nuevo); feature gate "Instagram Public Content Access" |
| Business discovery (benchmark de competidores) | **C** | eje `flows`; mismo gate de acceso público |
| Shopping / product tags read | **C** | eje `flows`; prereqs fuertes (Shop aprobado, BM admin) |
| Partnership ads / boost | **C** | eje `flows` + puente Marketing API (`legacy_*_id`, `ads_read`) — conecta con el plan de Google Ads/Parte C |

## 7. Conclusión

**La Opción A aguanta la superficie completa de Meta**, con dos evoluciones ya
previstas y baratas: el eje `flows` en support matrix + catálogo (al primer
producto FB-only) y el patrón strategy para capacidades de fontanería doble
(al implementar DMs). Lo que NO debe pasar es acumular `if (isIgDirect)`
sueltos — cada nuevo branching debe caer en uno de los puntos nombrados de §4.

La intuición de "deberíamos verlo en todos lados como instagram_direct" se
satisface donde aporta — **support matrix (eje `flows`), catálogo, métricas y
un futuro badge en admin** — sin pagar el precio de partir la identidad de la
cuenta en dos.

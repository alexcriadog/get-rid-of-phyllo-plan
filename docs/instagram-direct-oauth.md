# Instagram Direct OAuth — explainer y decisión pendiente

> **Estado**: IMPLEMENTADO Y VALIDADO EN PRODUCCIÓN 2026-06-04 (rollout
> Opción C: feature flag `IG_DIRECT_ENABLED`, activo en prod). Plan:
> `docs/superpowers/plans/2026-06-04-instagram-direct-oauth.md`.
> Follow-up conocido: la telemetría BUC (x-app-usage) de IG-direct comparte
> bucket Redis con el app de FB — segregar por app-key antes de volumen de
> producción. `oauthToken.scopes` queda `[]` en seeds ig_direct
> (granted_permissions vive en account.metadata).
> Lo de abajo se mantiene como análisis de contexto/decisión.

## Validación producción 2026-06-04

Cuenta de prueba: `camaleonicanalytics` (workspace `demo`), conectada vía
"Connect with Instagram directly" desde la sample app (localhost:4000 →
connect-tool prod).

| Check | Resultado |
|---|---|
| Consent screen IG con scopes `instagram_business_basic, instagram_business_manage_insights` | ✅ |
| **Paridad canonical-ID**: `/me` `user_id` (IG-direct) == `instagram_business_account.id` (FB-graph) → upsert sobre la fila existente (account 2, `17841450633103215`), cero duplicados | ✅ |
| Seed con `metadata.oauth_flow='ig_direct'` (el upsert reemplaza metadata: pierde `page_id`, gana `oauth_flow` — esperado; `page_id` solo alimentaba hints de rate-limit) | ✅ |
| Sync E2E contra `graph.instagram.com/v22.0` — identity/audience/engagement/stories; demografía devuelve "Not enough users" (cuenta pequeña, soft-fail esperado), sin errores de token/host | ✅ |
| Refresh manual `/v1/accounts/2/refresh` → identity `fetched_at` fresco | ✅ |
| Cron refresh (`ig_refresh_token`) | ⏳ se ejercitará solo cuando el token entre en la ventana T-7d (~día 53); lógica espejo de Threads ya probada en prod |

Nota operacional: reconectar por IG-direct una cuenta que estaba conectada
vía FB-login **convierte la fila a IG-direct** (token de usuario IG,
refrescable, sin Page). Es el comportamiento de diseño del upsert.

### Incidente post-validación (mismo día, resuelto)

El fetcher de identity pedía 3 campos probe-confirmed que solo existen en el
FB-graph (`is_published`, `has_profile_pic`, `legacy_instagram_user_id`).
`graph.instagram.com` los rechaza con `IGApiException code 100` y un campo
malo invalida toda la llamada → 5 fallos → circuit breaker → auto-pausa de
la cuenta. Los otros 3 productos nunca fallaron. Fix `307c536`: field list
por flow (`profileFieldsFor`), con test de regresión; cuenta despausada vía
`POST /admin/accounts/2/unpause` y re-sincronizada en verde.
**Lección para futuros fetchers IG**: cualquier campo añadido por probe
contra el FB-graph debe validarse también contra la superficie IG-Login o
condicionarse por `oauth_flow`.

---

## TL;DR

- Hoy todas las cuentas IG se conectan vía **Facebook Login** (la cuenta IG Business tiene que estar linked a un FB Page).
- IG Direct OAuth es un flow alternativo que conecta **cuentas IG sin FB Page asociado** — útil para creators que nunca han tocado Facebook.
- **Lo bueno**: cobertura ampliada (~10-30% creators no tienen FB Page enlazado), refresh de token automático cada 60d (mejor UX), no depende del FB Page picker (UX más simple).
- **Lo malo**: pierde **hashtags**, **ads**, **branded content**, **mention discovery** (esos endpoints solo viven en el FB graph). **Operacionalmente duplica** OAuth surface: dos callbacks, dos token endpoints, dos cron de refresh, dos rate-limit buckets, dos sets de monitoring.
- **Decisión arquitectónica clave**: misma plataforma `instagram` con flag de metadata vs plataforma separada `instagram_direct`. Mi recomendación es la primera (justificación en §5).
- **Effort**: 3-5 días. **No requiere App Review** para los scopes mínimos (`instagram_business_basic`); los demás (`instagram_business_manage_*`) sí.
- **Cuándo NO**: si las cuentas que vamos a captar son agencias o brands con FB Page, no añade valor. Solo aporta cuando trabajemos con creators puros.

---

## 1. ¿Por qué importa?

### El problema real

Cuando un cliente quiere conectar su cuenta de Instagram al POC, hoy le pedimos:

1. Login con Facebook.
2. Seleccionar la **Page de Facebook** asociada.
3. Confirmar que esa Page tiene una **cuenta IG Business linked**.

Para creators "puros" (que nunca han abierto FB), esto es una fricción enorme:

- Tienen que crear un FB Page (10 minutos + entender el concepto de Page).
- Tienen que enlazar IG → Page (otros 10 minutos en la app de IG).
- Tienen que volver al POC y hacer el flow.

Muchos creators **no llegan al final** de ese onboarding. Se pierde la cuenta.

### IG Direct soluciona esto

Meta introdujo en 2024 un OAuth flow nativo de Instagram que **no requiere Facebook Page**:

```
Antes:                       Direct:
  IG profile                   IG profile
     ↓                            ↓
  FB Page (manual!)             OAuth callback
     ↓                            ↓
  FB OAuth                     graph.instagram.com
     ↓
  graph.facebook.com
```

Tres pasos menos. **Onboarding 1-click** desde la app de IG.

### Impacto estimado

Sin métricas concretas de conversión todavía, pero rangos típicos en la industria:

- **Agencias B2B**: ~5% de cuentas que gestionan no tienen FB Page (las grandes brands sí, las pequeñas no). Direct aporta poco.
- **Creator-economy**: 20-40% de creators medianos (5k-500k followers) no tienen FB Page activo. Direct aporta mucho.
- **Influencer marketing**: 10-20% de influencers que vamos a discover por hashtag (cuando esto entre) no estarán linked a FB. Direct aporta para captarlos.

**Decisión**: si Camaleonic Analytics se va a apoyar más en creators que en agencias, Direct es ROI alto. Si todo es agencias B2B, es ROI bajo.

---

## 2. Diferencias técnicas vs FB Login

| Aspecto | FB Login | IG Direct |
|---|---|---|
| **Authorization URL** | `https://www.facebook.com/v22.0/dialog/oauth` | `https://www.instagram.com/oauth/authorize` |
| **Token endpoint** | `graph.facebook.com/v22.0/oauth/access_token` | `api.instagram.com/oauth/access_token` |
| **Long-lived exchange** | `?grant_type=fb_exchange_token` (1-time, 60d) | `graph.instagram.com/access_token?grant_type=ig_exchange_token` (1-time, 60d) |
| **Refresh recurrente** | ❌ no soportado — re-auth manual al expirar | ✅ `graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` (cada 60d, token ≥24h old) |
| **API base host** | `graph.facebook.com/v22.0` | `graph.instagram.com/v22.0` |
| **Discovery del IG ID** | `/me/accounts` → page → `instagram_business_account.id` | `/me?fields=id,username` (1 call) |
| **FB Page requerida** | ✅ obligatoria | ❌ no requerida |
| **App ID** | Mismo Meta App | Mismo Meta App, distinto product config |
| **Webhook delivery** | `graph.facebook.com` | `graph.instagram.com` (separate config) |

### Scopes disponibles

| Scope (Direct) | Equivalente FB Login | App Review necesario |
|---|---|---|
| `instagram_business_basic` | `instagram_basic` | ❌ no (no-review tier) |
| `instagram_business_manage_insights` | `instagram_manage_insights` | ✅ sí |
| `instagram_business_manage_comments` | `instagram_manage_comments` | ✅ sí |
| `instagram_business_manage_messages` | `instagram_manage_messages` | ✅ sí + business verification |
| `instagram_business_content_publish` | `instagram_content_publish` | ✅ sí |

### Token lifecycle — diferencia crítica

**FB Login**:
```
Día 0:    obtain code → exchange → 60d token
Día 60:   token expires
Día 60+:  user must MANUALLY re-auth (we email them)
          → drops 30-50% en re-engagement
```

**IG Direct**:
```
Día 0:    obtain code → exchange → 60d token
Día 50:   cron auto-refresh → new 60d token
Día 100:  cron auto-refresh → new 60d token
…         token persists indefinitely (until user revokes)
```

**Esto es el VALOR principal de Direct más allá de "no hace falta FB Page"**: tokens prácticamente eternos sin re-auth fatigue.

---

## 3. Capability matrix — qué se gana, qué se pierde

| Producto | FB Login | IG Direct |
|---|---|---|
| **Identity (profile)** | ✅ | ✅ |
| **Audience (demographics)** | ✅ | ✅ |
| **Content (posts/reels/stories)** | ✅ | ✅ |
| **Per-post insights** | ✅ | ✅ |
| **Comments** | ✅ | ✅ (scope distinto) |
| **DMs** | ❌ (no scope hoy) | ✅ con `_manage_messages` |
| **Refresh automático** | ❌ | ✅ |
| **Hashtag tracking** (`/ig_hashtag_search`) | ✅ | ❌ Meta lo restringe a FB Login |
| **Tagged media** (`/tags`) | ✅ con scope | ❌ no expuesto en IG graph |
| **Mentioned media** (`/mentioned_media`) | ✅ | ❌ |
| **Ads insights** (Marketing API) | ✅ con `ads_read` | ❌ requiere ad account, gated por FB |
| **Branded content (inbound)** | ✅ con scope | ❌ |
| **Product tags (IG Shopping)** | ✅ con scope | ❌ |
| **Live videos** | ✅ | ✅ |

**Resumen**: Direct cubre el **80% del producto** (identity + audience + content + comments) pero pierde features avanzadas que dependen del FB graph subsidiarily. Si tu uso primario es **dashboard de métricas**, Direct llega. Si es **discovery (hashtags, mentions) o ads attribution**, FB Login sigue siendo el flow principal.

---

## 4. Escalabilidad — el corazón de la decisión

### Doble surface OAuth

Implementar Direct **duplica** la complejidad operacional de OAuth:

| Componente | FB Login (hoy) | + IG Direct |
|---|---|---|
| Authorize URLs en `connect-tool/lib/platforms.ts` | 1 | 2 |
| Callback handlers | 1 | 2 |
| Token exchange endpoints | 1 | 2 |
| Discovery (canonical_user_id) paths | 1 | 2 |
| Refresh cron jobs | 0 (no refresh) | 1 (Direct cron) |
| Rate-limit buckets a monitorizar | 1 (BUC FB) | 2 (BUC FB + BUC IG) |
| Webhook subscriptions | 1 host | 2 hosts |
| Bug surface (potential incidents) | 1 flow | 2 flows |
| Documentación / runbooks | 1 | 2 |

**El doble surface no es lineal** — añade ~30-50% al coste operacional del módulo IG, no doble. Pero suma.

### Rate limits — bucket separation

Meta tiene rate limits "Business Use Case" (BUC) por (app, IG-user). Con dual-client:

- **Cuentas FB-routed** consumen **bucket FB** del IG-user.
- **Cuentas IG-Direct** consumen **bucket IG** del IG-user.

Para una **misma IG account** que se conectara por ambos flows (raro pero posible), los buckets son **separados** — efectivamente doblas tu allowance. Pero también doblas el monitoring para detectar throttling: necesitas dos series de tiempo en `/admin/rate-limits`, una por flow.

A escala N cuentas:

```
Hoy:    N tokens × 200 puntos/h FB BUC = 200N puntos/h
Mixto:  N_FB × 200/h FB + N_DIRECT × 200/h IG = más capacity total
```

### Token refresh cron — operacional

Con Direct llega un cron nuevo:

- **Frecuencia**: cada 6h escanear `OAuthToken` con `platform='instagram'` AND `metadata.is_ig_direct=true` AND `expires_at < now + 7d` AND `created_at > 24h ago`.
- **Llamada**: `GET https://graph.instagram.com/refresh_access_token?...` por cada token candidato.
- **Failure modes**:
  - Token revocado por user (raro pero pasa) → marcar account `needs_reauth`.
  - Network glitch → retry con backoff.
  - Rate limit del propio refresh endpoint (200/h por app) → batched.
- **Monitoring**: nuevo product key `ig_direct_refresh` en `api_call_log`. Alert si fail rate >5% durante 24h.

Es **un cron más**. Manageable, pero suma.

### Migration / fallback story

Si Meta cambia las reglas (suele pasar 2x/año):

- **Si rompe FB Login**: Direct sigue funcionando. **Diversificación = resiliencia**.
- **Si rompe Direct**: FB Login sigue. Caer al fallback es manual: re-auth con FB Login.
- **Si Meta unifica los flows** (rumored para 2026-2027): refactor controlado porque el flag `is_ig_direct` ya identifica qué cuentas migrar.

Tener ambos flows nos hace **menos frágiles** ante cambios upstream. Es un seguro a coste operacional permanente.

### Coste de capacidad — N cuentas

Para 100 cuentas IG (FB Login todas):
- 100 tokens, 1 cron de refresh manual cuando expiran (5-10 re-auths/mes).
- 100 BUC buckets, todo en FB graph.
- Operacional: 1 dashboard, 1 alert.

Para 100 cuentas IG (50 FB + 50 Direct):
- 100 tokens. Direct se auto-refresca; FB sigue manual (~5 re-auths/mes).
- 100 BUC buckets, separados por host. Capacity efectiva: ~2x.
- Operacional: 1 dashboard con dimension `is_ig_direct`, 1 alert per dimension. **+30-40% complexity.**

Para 1000 cuentas IG (mixto):
- Mismo overhead operacional pero *amortizado* sobre más cuentas — la fricción inicial ya está pagada.
- A esta escala, el refresh automático de Direct evita ~50-100 re-auth manuales/mes. **Justifica el coste con creces.**

**Curva**: el coste de Direct es **fijo en infra** (un cron, un cliente más), pero el beneficio escala con N. **Punto de inflexión: ~50 cuentas mixtas.** Por debajo, no aporta. Por encima, aporta cada vez más.

---

## 5. Decisión arquitectónica: misma plataforma vs separada

### Opción A — Misma plataforma `instagram` + flag `metadata.is_ig_direct`

```ts
// Account row
{
  id: 11,
  platform: 'instagram',
  canonical_user_id: '17841...',
  metadata: { is_ig_direct: true, …}
}

// Adapter routing
const client = account.metadata.is_ig_direct
  ? igDirectClient   // base: graph.instagram.com
  : igFbClient;      // base: graph.facebook.com
```

**Pros**:
- 1 row per IG identity. Brand ve "Instagram" único.
- Reuse 95% de fetchers/mappers/UI/scheduler.
- Support matrix gana 1 columna (`is_ig_direct`) — los gates de hashtags/ads ya iban por ahí.
- Si Meta unifica flows en el futuro, refactor consiste en **borrar el flag**.

**Contras**:
- El adapter tiene branching `if (is_ig_direct)` cada vez que hace una call.
- El `support-matrix` y la UI tienen que conditional-render features (`hashtags: not_supported_for_direct`).
- El telemetría per-feature requiere split por dimensión.

### Opción B — Plataforma separada `instagram_direct`

```ts
// Account row
{
  id: 12,
  platform: 'instagram_direct',
  canonical_user_id: '17841...',
  metadata: { …}
}

// Adapter selection
const adapter = account.platform === 'instagram_direct'
  ? igDirectAdapter
  : igFbAdapter;
```

**Pros**:
- Adapter completamente aislado, sin conditionals — más fácil de razonar.
- Telemetría natural por plataforma (no requiere dimensions).
- Si en el futuro Direct evoluciona como "producto distinto" (pricing tier, dashboard separado), ya está separado.

**Contras**:
- **Duplica significativamente código**: support-matrix, controller, UI dashboard cards, sync.scheduler entries.
- 1 brand puede acabar con 2 rows ("Instagram" + "Instagram Direct") — UX confusa salvo que los unifiquemos en la UI a posteriori.
- El módulo IG se duplica al 50-60% (porque los fetchers serían casi idénticos).
- Si Meta unifica flows, el refactor es una **migración de schema** (cambiar `platform` value en producción), no un flag flip.

### Mi recomendación: **Opción A**

Razones:
1. **La identidad canónica es la misma** — el IG Business User ID. No hay producto distinto, solo auth distinta.
2. **El branching `if (is_ig_direct)` es local**: solo en el adapter routing y en la support matrix. No infecta cada fetcher individual (los clientes inyectan el host correcto).
3. **Si Direct se vuelve dominante**, hacemos el flip mental "todos son Direct" sin schema migration.
4. **Si Direct fracasa o Meta lo retira**, borramos el flag y volvemos a un mundo single-flow sin renombrar production rows.

Opción B es razonable pero paga complejidad ahora a cambio de una flexibilidad que probablemente no necesitemos.

---

## 6. Riesgos y trade-offs

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Dual-client leak: una call usa el host equivocado, fails con 404 | Media (refactor primer mes) | Integration test que verifica cada fetcher usa el host correcto según `metadata.is_ig_direct` |
| Refresh cron silently fails y todos los tokens Direct mueren | Baja | Alert si fail rate >5% durante 24h. Email al user antes de expirar. |
| Meta retira IG Direct API completamente (precedente: lo han hecho con scopes) | Baja-media | Direct accounts pueden re-conectarse vía FB Login (si tienen Page). Banner "reconnect" en UI. |
| Usuario conecta misma IG por ambos flows → 2 rows duplicadas en DB | Baja | Unique constraint `(platform, canonical_user_id)` rechaza la 2ª. |
| Direct token revocado mid-sync genera errores cascade | Media | `isExpectedGraphFailure` ya clasifica `(#190)` como token-dead → account auto-pause |
| BUC bucket separation se entiende mal y enviamos demasiadas calls | Baja | `/admin/rate-limits` tiene `product` dimension. Vista por flow + cuenta. |

---

## 7. Cuándo NO implementar Direct

Direct **no es siempre la respuesta correcta**. Casos en los que mejor no:

1. **Si todas tus cuentas son brands B2B con FB Page**: no aporta cobertura nueva. Estás añadiendo overhead por cero clientes adicionales.
2. **Si tu equipo ops es <2 personas**: el doble surface OAuth es real. Mejor consolidar el flow existente que añadir uno nuevo.
3. **Si tu prioridad es hashtag tracking / ads attribution**: Direct te resta features. Refactor de FB Login es mejor.
4. **Si los creators que captas YA tienen FB Page**: solo no lo saben, y un onboarding educativo (video tutorial) puede ser más cheap que implementar Direct.
5. **Si Meta anuncia unification (rumored 2027)**: mejor esperar a que ellos definan el flow final que apostar a un horse que igual cambian.

---

## 8. Alternativas si NO implementamos Direct ahora

### A — "Solo FB Login con buena UX"

Mejoramos el onboarding actual:
- Video tutorial 60s "Cómo crear FB Page y enlazar tu IG".
- Detección automática: si el user falla el FB Login, redirigir a la guía.
- Email de soporte cuando vemos a alguien intentándolo varias veces.
- **Effort**: 0.5-1 día. **Cobertura**: igual que hoy (cuentas con FB Page).

### B — "Solo FB Login + cuenta de servicio"

Para creators que no quieren tocar FB, ofrecemos crear una "shadow Page" gestionada por nosotros (con su consentimiento) y enlazar su IG ahí.
- Legalmente ambiguo (Meta TOS).
- Operacionalmente costoso (gestionamos N pages).
- **No recomendado**.

### C — "Direct + parámetros de cobertura"

Implementamos Direct PERO solo lo activamos para clientes que explícitamente lo piden o cuyo onboarding falla con FB Login dos veces. Reduce el blast radius del rollout.
- **Effort**: 3-5 días + flag de feature `IG_FEATURE_DIRECT_OAUTH=on|off`.
- **Cobertura**: igual que A en escenario 1, igual que Direct full en escenario 2.

### D — "Posponer Direct hasta tener N creator-economy clientes"

Setear un threshold (e.g. "cuando tengamos 5 cuentas perdidas explícitamente por no-FB-Page, implementamos Direct"). Hace la decisión data-driven en lugar de speculative.
- **Effort hoy**: 0. Solo añadir un campo `signup_blocker` al funnel del connect-tool.

---

## 9. Decisiones que tendremos que tomar

Antes de implementar, definir:

1. **¿Qué % de los clientes objetivo son creators puros sin FB Page?** Si <10%, opción D (posponer). Si >25%, opción C (con flag) o full Direct. Si entre 10-25%, opción C es lo más razonable.

2. **¿Banner de elección o fallback automático?**
   - **Banner**: usuario ve dos botones "Connect via Facebook" (recommended) y "Connect Instagram directly". UX clara pero más cognitive load.
   - **Auto-fallback**: empezamos con FB Login; si falla (no Pages, etc.) ofrecemos Direct. UX más simple pero el user siente "rebote".

3. **¿Activamos `instagram_business_manage_messages` (DMs)?** Direct lo soporta. FB Login también pero requiere App Review + business verification. Si lo pedimos en Direct desde día 1, ahorramos tiempo después. Pero pedirlo significa más fricción en consent screen.

4. **¿Catálogo de scopes del POC se separa por flow o se unifica?** Si lo unificamos en un solo enum `IG_SCOPES`, el código del flow Direct tiene que hacer name-mapping (`instagram_basic ↔ instagram_business_basic`). Si los separamos, mantenemos dos enums.

5. **¿Soporte matrix axis es `is_ig_direct: boolean` o `oauth_flow: 'fb-login' | 'direct'`?** El primero es lo que propuse; el segundo es más extensible si Meta añade un tercer flow algún día. Mi inclinación: `oauth_flow` string para futuro-proofing.

---

## 10. Effort breakdown

| Pieza | Effort |
|---|---|
| `connect-tool/lib/platforms.ts` — `instagram_direct` PlatformDef | M (1 d) |
| `poc/src/modules/auth/ig-direct-refresh.service.ts` — cron de refresh | S (4 h) |
| `instagram.module.ts` + `instagram.adapter.ts` — dual-client + routing | M (1 d) |
| `instagram.support-matrix.ts` — eje `oauth_flow` para gating de hashtags/ads | XS (1 h) |
| `connect-tool` UI — botón "Connect Instagram directly" | S (3 h) |
| Integration test — cada fetcher usa el host correcto según flag | S (4 h) |
| `prisma` migration — no requerida (`Account.metadata Json?` ya soporta el flag) | XS |
| `/admin/rate-limits` — dimension `oauth_flow` | S (3 h) |
| Operational: runbook para refresh cron failures, banner re-auth | S (2 h) |
| **Total** | **~3-5 d** |

Sin App Review necesario para v1 si nos limitamos a `instagram_business_basic`. Si añadimos `_manage_insights` o `_manage_comments`, son los mismos reviews que ya gestionamos en el plan v1 backlog.

---

## 11. Mi recomendación pragmática

Basado en todo lo anterior:

> **Posponer Direct hasta tener señal real de demanda**.

Razones concretas:

1. **Ninguna de tus 3 cuentas IG actuales (Camaleonic, WE ARE 93, Alex Marquez) lo necesita** — todas tienen FB Page.
2. **Tu pipeline cercano son agencias B2B + creators con presencia establecida** — la mayoría tienen FB Page o pueden crearlo.
3. **El rollout v1 ya cubre el 80% del producto** (Phase 0/A/B/F live) sin Direct. Direct no desbloquea ninguna feature nueva — solo onboarding más fácil para un subset de creators.
4. **Implementación tiene coste operacional permanente** (cron, dashboard, runbook). Ese coste solo se justifica con un volumen que aún no tenemos.
5. **Phyllo (al que reemplazamos)** usa FB Login estándar. Si su market funcionó así, el nuestro probablemente también.

**Plan concreto si pospones**:
- Añadir un campo `signup_blocker_reason` al funnel del connect-tool (`'no_fb_page'`, `'page_no_ig'`, `'other'`).
- Cada vez que un usuario falla el onboarding, registrar el motivo.
- Cuando veamos **5+ cuentas perdidas explícitamente por "no_fb_page"**, implementamos Direct.
- Time-to-decision: 1-3 meses con tracking activo.

Si decides que sí lo quieres ya (porque vas a captar creators puros agresivamente las próximas semanas), implementarlo es 3-5 días — pero con la **opción C** (feature flag, opt-in, no default), no full rollout.

---

## 12. Referencias oficiales

- [IG Login overview](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)
- [IG Login business flow](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Permissions reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/permissions)
- [IG User node fields](https://developers.facebook.com/docs/instagram-platform/reference/instagram-user)
- [Token refresh endpoint](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login#refresh-the-token)

---

**Cuándo decidir esto**: cuando tengamos data del funnel (1-3 meses) o cuando un cliente concreto lo pida. Mientras tanto, el plan v1 sin Direct cubre el caso real.

**Cuando estés listo**, dile a Claude algo tipo "ig direct now con opción C" (o A o B) y arrancamos el rollout.

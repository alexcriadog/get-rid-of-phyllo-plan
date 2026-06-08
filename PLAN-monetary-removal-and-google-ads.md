# Plan — Quitar scope `monetary` + estudio de coste del Google Ads API

> Documento de trabajo. Cuando la implementación esté hecha, este archivo
> se puede borrar (`rm PLAN-monetary-removal-and-google-ads.md`).

## Context

Dos cosas, independientes:

1. **Quitar `yt-analytics-monetary.readonly` de `verify-youtube/`**. La feature de mostrar revenue del creador no entra en producto, así que sacamos el scope antes de mandar el proyecto a verificación de Google. Menos scopes sensibles = menos justificación que escribir + consent screen más breve.
2. **Estudiar el coste real de añadir Google Ads API** para ver las campañas de YouTube del usuario conectado. No implementamos nada; solo dejamos el informe atado para decidir si entra y cuándo.

Aclaración importante de fondo (lo confirma la investigación): **revenue** (lo que el creador gana publicando) y **Google Ads** (lo que el creador paga anunciando) son lados opuestos de YouTube. Quitar `monetary` no implica que tengamos que reemplazarlo con Google Ads — son datos distintos. Lo que la frase "ver campañas en YouTube" describe es el **lado anunciante** (advertiser), no el de publisher.

---

## Parte A — Quitar `yt-analytics-monetary.readonly` de `verify-youtube/`

Cambio mecánico, una sola PR. ~6 archivos, ~200 LOC.

### Archivos a editar

| Archivo | Cambio |
|---|---|
| `verify-youtube/lib/youtube.ts` | Línea **24**: quitar la entrada `yt-analytics-monetary.readonly` del array `YT_SCOPES`. Líneas **204–254**: borrar la sección comentada `── yt-analytics-monetary.readonly`, la interfaz `RevenueSummary` y la función `fetchRevenue7d`. |
| `verify-youtube/pages/verified/[session].tsx` | Línea **13**: quitar `fetchRevenue7d` del import. Línea **17**: quitar `type RevenueSummary`. Línea **31**: quitar `revenue: Outcome<RevenueSummary>;` de `PageProps`. Línea **54**: quitar `safe(() => fetchRevenue7d(...))` del `Promise.all`. Líneas **227–273**: borrar el `<ScopeDemoCard>` de revenue entero. |
| `verify-youtube/pages/privacy.tsx` | Líneas **65–68**: borrar el bullet del scope `yt-analytics-monetary.readonly` en la sección 2 ("What data we read"). Repasar también el resto del texto en busca de menciones a "revenue" o "monetization" — quitar. |
| `verify-youtube/pages/terms.tsx` | Línea **35**: la descripción del servicio menciona "revenue metrics" — cambiar a "engagement metrics" para que no haya inconsistencia con privacy. |
| `verify-youtube/README.md` | Línea **22**: quitar `yt-analytics-monetary.readonly (sensitive)` de la lista. Línea **48**: quitar la mención en la sección "Google Cloud setup → Scopes". |
| `verify-youtube/.env.example` | No toca (no menciona scopes específicos). |

### Cosas que NO se tocan en esta tarea (flagged para futuro)

- **`connect-tool/lib/platforms.ts:55`** — sigue pidiendo `yt-analytics-monetary.readonly`. Es código del PoC, no se rompe nada. Si en algún momento se quiere alineación total, PR aparte.
- **`poc/src/modules/admin/admin.service.ts:2361`**, **`poc/web/lib/metric-catalog.ts:175, 201–204`**, **`poc/src/modules/platforms/youtube/fetcher/youtube-audience.fetcher.ts:102`** — el backend del PoC sigue mapeando revenue. Cambio mayor, fuera de alcance.

### Pasos manuales en Google Cloud Console

En el proyecto **`GROP-Youtube`** → OAuth consent screen → Edit Scopes:
- **Quitar** `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`.
- Si la consent screen ya está sometida a verificación, hay que actualizar el formulario (Google permite editar mientras está in review): la lista de scopes solicitada se actualiza y la justificación de `monetary` deja de hacer falta. Esto **no reinicia** la verificación de los scopes restantes.

### Deploy

Idéntico al anterior:
```bash
./tools/deploy.sh
# Caddy no toca cert; el build recoge el nuevo Next.
```

### Verificación end-to-end

1. Build local: `cd verify-youtube && pnpm typecheck && pnpm build` → todo verde.
2. Smoke test prod:
   ```bash
   curl -sS -I https://yt-connector.camaleonicanalytics.com/
   curl -sS -o /dev/null -w "%{redirect_url}\n" https://yt-connector.camaleonicanalytics.com/api/oauth/start/youtube
   ```
   El query `scope=` debe contener **5** strings (no 6): `openid`, `userinfo.email`, `userinfo.profile`, `youtube.readonly`, `yt-analytics.readonly`. Ningún `yt-analytics-monetary`.
3. OAuth manual: hacer la conexión con la cuenta de test. La consent screen debe mostrar 3 permisos legibles (no 4 — el de monetary desaparece). La página `/verified/{session}` debe renderizar **3 tarjetas** (no 4): Connected Google account, Channel snapshot, Views last 7 days. La de Revenue ya no existe.
4. `/privacy` y `/terms` se cargan y no mencionan revenue/monetary.

---

## Parte B — Coste real de añadir Google Ads API

Resumen de la investigación contra los docs oficiales de Google (`developers.google.com/google-ads`). Recomendaciones al final.

### B.1 — Qué nos da

El Google Ads API expone, **read-only para campañas de video**:

- Recurso `campaign` con filtro `campaign.advertising_channel_type = 'VIDEO'` → campañas TrueView / In-stream / Shorts en YouTube.
- Métricas: `metrics.video_views`, `metrics.video_view_rate`, `metrics.average_cpv`, `metrics.cost_micros`, `metrics.impressions`, `metrics.clicks`, `metrics.ctr`, `metrics.engagements`.
- Lenguaje de consulta: **GAQL** (Google Ads Query Language), SQL-like.
- Limitación: **read-only** para video. No se pueden crear / actualizar / pausar campañas vía API (la API soporta create/update sólo para Demand Gen).

Esto es el lado **anunciante**. Es información distinta a la que daba `yt-analytics-monetary.readonly` (que era el lado *publisher* — lo que el creador cobra). No es un reemplazo, es otra dimensión.

### B.2 — Scope OAuth

- Scope: `https://www.googleapis.com/auth/adwords`.
- Clasificación: **sensitive** (no restricted → **no requiere auditoría CASA**).
- Implicación: misma categoría que `youtube.readonly` que ya tenemos. La verificación del proyecto añadiría una justificación más, sin saltar a auditoría externa.

### B.3 — Developer token (el bottleneck)

A diferencia de YouTube, Google Ads requiere un **developer token** ligado a una **cuenta Manager (MCC)** que **nosotros** creamos. El token es de la app, no del usuario.

| Tier | Acceso | Ops/día | Aprobación |
|---|---|---|---|
| Test Account | Solo cuentas de test (datos = 0) | 15.000 | Automático tras crear la MCC |
| **Basic Access** | Test + producción | 15.000 | Revisión manual de Google, ~2 días hábiles |
| Standard Access | Test + producción | Ilimitado | Revisión manual, ~10 días hábiles |

Requisitos para Basic:
- Una MCC nuestra (gratis crearla; **sin requisito de spend activo**).
- Website público funcionando (lo tenemos: `yt-connector.*` o el dominio principal de la empresa).
- Email monitorizado para que Google pregunte.
- Descripción del use case y cuántas cuentas vamos a tocar.

### B.4 — Modelo de auth (cómo encaja con nuestro flow actual)

```
Usuario (creador) → OAuth con scope `adwords`
                  → su access_token + su customer_id (Google Ads)
                  +
Nosotros          → developer_token (de NUESTRA MCC)
                  ↓
                  Llamadas a googleads.googleapis.com
```

Detalles clave:
- **El creador NO necesita una MCC propia.** Si tiene una cuenta de anunciante directa, vale.
- Tras OAuth, llamamos a `ListAccessibleCustomers` con su access_token → nos devuelve sus `customer_id`s.
- En cada query añadimos el header `developer-token: <nuestro>` y el path `/customers/{customer_id}/googleAds:search`.
- `login-customer-id` header sólo se pone si el usuario tiene una MCC y queremos consultar una cuenta hija; en el caso simple se omite.

### B.5 — Cliente Node.js

Google **no** publica SDK oficial para Node. Opciones:
- **REST directa** (`fetch` o `axios` contra `googleads.googleapis.com/v17/customers/...:search`). Suficiente para nuestro volumen, sin gRPC.
- `Opteo/google-ads-node` (gRPC, comunidad, mantenida) — sólo si volumen alto.

Recomendación: REST con axios, mismo patrón que ya tenemos en `verify-youtube/lib/youtube.ts`. No nos compensa gRPC.

### B.6 — Coste real

| Bloque | Tiempo / esfuerzo | Notas |
|---|---|---|
| Crear MCC nuestra + solicitar Basic developer token | 2–4 h setup, 0–14 días de espera | Cuello de botella humano de Google. No bloquea desarrollo (mientras esperamos podemos trabajar contra cuenta de test). |
| Añadir scope `adwords` al consent screen | 30 min | Editar consent screen del proyecto donde meta el `adwords`. |
| OAuth flow ya existente + ListAccessibleCustomers + persistir `customer_id` | 4–8 h | Patrón calcado del flujo de YouTube ya escrito. |
| GAQL helper + 3–4 queries de campañas video | 8–12 h | Queries listas en el informe (campaign + ad_group + metrics filtrado por VIDEO). |
| UI: tabla campañas, métricas video, filtro de fechas | 12–20 h | Depende de qué encaje queramos. |
| Tests, manejo de errores, rate-limit retry, caché | 8–12 h | El API devuelve errores muy específicos (USER_PERMISSION_DENIED, QUOTA_ERROR, etc.). |
| Cuenta de test con datos sembrados para QA antes de tener Basic | 2–4 h | Crear cuenta hija de la MCC, simular campañas. |
| **Total ingeniería** | **~40–60 h** | Más 0–14 días de espera del token. |

### B.7 — Decisión clave: ¿mismo Cloud project o uno nuevo?

La investigación deja dos opciones razonables; la **recomendación** depende del estado de la verificación del proyecto `GROP-Youtube`:

| Estrategia | Pro | Contra |
|---|---|---|
| **Mismo proyecto `GROP-Youtube`** | Una sola consent screen, un solo OAuth client, un solo `client_id` que reusan connect-tool / verify-youtube / app principal. | Si Google rechaza algo en cualquiera de los scopes, bloquea a todos. La verificación pasa a tener más expediente que justificar. |
| **Cloud project nuevo dedicado a `adwords`** | Verificación de Ads desacoplada de la de YouTube. Cero riesgo de contagio. | Otro consent screen que mantener; el usuario verá dos pop-ups si en algún momento usa ambas integraciones. |

**Mi recomendación**: si la verificación del `GROP-Youtube` actual está **submitted** y queremos cerrarla ya, **proyecto nuevo** para `adwords`. Si todavía no se ha enviado o aún estamos editando scopes, **mismo proyecto** y se mete todo en un único review.

### B.8 — Pitfalls que ya hemos identificado

1. **Test accounts devuelven métricas en cero** → para QA real con métricas hace falta haber recibido Basic developer token. Mock o stub mientras esperamos.
2. **`customer_id` ≠ Google account ID** → la confusión típica. Hay que llamar a `ListAccessibleCustomers` después del OAuth y persistir el `customer_id` correcto.
3. **`login-customer-id` header**: si el usuario tiene MCC propia, va. Si no, se omite. Si se mete cuando no toca, da `USER_PERMISSION_DENIED`.
4. **Video API es read-only** → no podemos prometer "gestiona tus campañas desde aquí", solo "léelas".
5. **Rate limits**: Basic = 15k ops/día, una query GAQL = 1 op. Para nuestro volumen (un creador, queries on-demand) está sobrado. Si se diseñan dashboards con polling agresivo, se puede consumir rápido.

### B.9 — Blockers absolutos

Ninguno. No hay requisitos de país, de tamaño de empresa, ni de spend activo. La única "barrera" es la espera del Basic developer token (~2 días de revisión manual).

---

## Parte C — Recomendación y decisiones que necesitamos cerrar

1. **Quitar `monetary` ya** (Parte A, 1 PR mecánica). Independiente del resto.
2. **Google Ads**: no integrarlo en `verify-youtube/`. Esto es una feature del producto real, vive en la app principal de la empresa cuando exista. Lo único que conviene **arrancar ya** (en paralelo) es:
   - Crear la MCC nuestra (gratis, 30 min).
   - Solicitar Basic developer token (la cuenta atrás de los ~2 días empieza desde que enviamos).
3. **Cloud project para `adwords`** — decisión pendiente: depende de en qué punto esté la verificación de `GROP-Youtube` cuando estemos listos para implementar.

### Open items para resolver entre tú y yo antes de seguir

- ¿Quieres que en este mismo pase ejecutemos también la actualización del consent screen en Google Cloud Console (quitar `monetary` de scopes registrados), o lo haces tú a mano y yo solo hago el código?
- ¿Quieres que arranque el alta de la MCC + petición del developer token ya, en paralelo a otras cosas, para no perder los días de revisión de Google?

## Archivos clave referenciados

- `verify-youtube/lib/youtube.ts` (líneas 24, 204–254)
- `verify-youtube/pages/verified/[session].tsx` (líneas 13, 17, 31, 54, 227–273)
- `verify-youtube/pages/privacy.tsx` (líneas 65–68)
- `verify-youtube/pages/terms.tsx` (línea 35)
- `verify-youtube/README.md` (líneas 22, 48)
- Cross-impact (no se tocan ahora): `connect-tool/lib/platforms.ts:55`, `poc/src/modules/admin/admin.service.ts:2361`, `poc/web/lib/metric-catalog.ts:175,201–204`, `poc/src/modules/platforms/youtube/fetcher/youtube-audience.fetcher.ts:102`

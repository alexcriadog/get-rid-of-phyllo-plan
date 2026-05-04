# El cubo único de Meta — el "rate limit por aplicación"

**Status:** Living
**Last updated:** 2026-05-04

Esta doc explica, sin siglas, el único límite de Meta que es "global" para nuestra aplicación: el que comparten **todos** los clientes que conectan sus cuentas. El resto de límites son individuales por cuenta y crecen con el tamaño de cada cuenta — no nos preocupan en la práctica. Este sí merece la pena entenderlo bien.

---

## 1. La idea en una frase

Meta nos pone **un único contador para toda nuestra aplicación**, que se vacía solo cada hora, y cuyo tamaño **crece automáticamente con el número de usuarios distintos que han conectado su cuenta hoy**.

Si hoy hay 1 cliente activo → el contador es de **200 llamadas por hora**.
Si hoy hay 10 → **2.000 por hora**.
Si hoy hay 1.000 → **200.000 por hora**.

Así de sencillo. Crece linealmente con clientes activos. No te quedas pequeño nunca por defecto: cuantos más clientes, más capacidad.

---

## 2. La analogía del aforo del bar

Imagina que Meta es un local con un **aforo máximo de personas a la vez**. Nuestra app es uno de los promotores que mete gente. El aforo de nuestro promotor es **200 entradas por hora por cada cliente que ese día ha pasado por la barra**.

- Si hoy nuestro promotor tiene un solo cliente fijo (yo, el operador), nos dejan meter 200 personas/hora.
- Si mañana se conecta un cliente nuevo (un influencer real), nos dejan 400 personas/hora.
- Si la app explota y conectan 1.000 influencers, nos dejan 200.000 personas/hora.

El aforo crece con la base de clientes. Por eso este límite no nos limita a escalar: cuantos más conectan, más cabemos.

---

## 3. Qué calls cuentan en este cubo (y cuáles no)

Aquí está el matiz importante. **No todas las llamadas a Meta entran en este cubo.** Hay tres categorías:

### Sí cuentan
- Llamadas hechas con un **token personal del usuario** (las del flujo OAuth normal).
- Algunas llamadas concretas de páginas de Facebook, como `/insights` y `/stories`, aunque uses token de página (esto es una rareza no documentada, lo confirmamos en la práctica midiéndolo nosotros).

### No cuentan
- Llamadas hechas con un **token de página de Facebook**: la mayoría. Por eso forzamos siempre tokens de página al persistir (ver `connection-portal.md`).
- Llamadas a la API de Instagram con token de página: 0 cuentan.
- Llamadas a TikTok, Threads, YouTube, Twitch — esos son cubos separados, totalmente aparte de éste.

**Resultado neto en la práctica**: para una cuenta de Instagram conectada con token de página, el 0% de sus llamadas tocan este cubo. Para una página de Facebook, ~15-25% de sus llamadas tocan este cubo (los `/insights` y `/stories`). El resto del trabajo no cuenta.

---

## 4. Cómo lo medimos en tiempo real

Cada vez que llamamos a Meta, su respuesta nos trae una pequeña etiqueta que dice: **"de tu cubo, ya has gastado X%"**. Esta etiqueta es la fuente de verdad. La leemos en cada respuesta y la guardamos en Redis.

**Estado actual hoy**: en las últimas 24 horas hemos hecho 447 llamadas a Meta. La etiqueta de la última respuesta dice **0% gastado**. Estamos al fondo del cubo.

Para verlo en vivo, ve a `/admin/rate-limits` en la UI: la primera tarjeta de la sección "Meta BUC mirror" es siempre el cubo a nivel de aplicación. Mientras esa tarjeta esté en verde con un porcentaje pequeño, no hay riesgo.

---

## 5. Cómo lo gestionamos automáticamente

Antes de hacer cualquier llamada a Meta, el sistema mira esa etiqueta:

1. **Si el cubo está por debajo del 75%**: deja pasar.
2. **Si el cubo está al 75% o por encima**: deniega la llamada localmente (sin llegar a Meta), y el job se reagenda para más tarde con un retraso corto.
3. **Si Meta nos ha dicho explícitamente "espera N minutos"** (a través del campo `estimated_time_to_regain_access`): respetamos ese tiempo exacto.

El umbral del 75% deja un colchón cómodo. Significa que **nunca llegamos al 100% real**, que es donde Meta empezaría a devolvernos errores 429. Operamos siempre con margen.

---

## 6. Ejemplo concreto: ¿qué pasaría con MotoGP conectado?

Imagina que conectas la cuenta de Instagram de MotoGP, que sube **100 piezas de contenido al día** (60 posts/Reels + 40 historias).

| Acción del sistema | Llamadas/día | Cuentan al cubo de aplicación |
|---|---|---|
| Refrescar 90 días de Reels (engagement) | ~16.860 | 0 (token de página IG → exentas) |
| Refrescar historias activas | ~480 | 0 (mismo motivo) |
| Refrescar audiencia | ~5 | 0 |
| Refrescar identidad | ~20 | 0 |
| **Total** | **~17.400** | **0 al cubo de app** |

Resultado: con MotoGP conectado, el cubo a nivel de aplicación **no se mueve**. La presión va al cubo individual de MotoGP, que como tiene millones de impresiones tiene un margen prácticamente infinito (cientos de millones de llamadas/día disponibles).

Lo mismo si tienes 100 clientes MotoGP-style: el cubo de app sigue al 0% mientras todos usen tokens de página. Nada nos para.

---

## 7. ¿Cuándo SÍ podríamos preocuparnos?

Pensemos cuándo el cubo de aplicación podría llenarse:

### Caso 1 — Muchas páginas de Facebook con muchos posts
Las llamadas FB `/insights` y `/stories` cuentan al cubo aunque uses token de página. Si tienes 100 páginas FB cada una con 100 posts/día y refrescas 90 días, eso es ~25.000 llamadas/día contables al cubo de app. Con 100 clientes activos hoy = 100 × 4.800 = 480.000 al día de presupuesto. Estamos al **5%**. Sin problema.

### Caso 2 — Pocos clientes con muchísimo trabajo
Si solo tienes 1 cliente conectado (DAU=1), el cubo es 4.800/día. Si esa cuenta es una página FB con 100 posts/día y refrescamos 90 días = 25.000 llamadas/día contables. Eso sería **520% del cubo** — imposible. El sistema se autolimitaría al 75% antes y los jobs se rebotarían constantemente.
**Cuándo pasaría esto en la realidad**: jamás. Si hay un cliente de ese volumen conectado, también habrá decenas de developers, testers y operadores tocando la app, así que el DAU real es mucho mayor que 1.

### Caso 3 — Bug que dispara llamadas en bucle
Un loop infinito en código nuestro podría disparar miles de llamadas/segundo. La etiqueta de Meta tarda en actualizarse (la vemos en la respuesta, no antes), así que en pocos segundos el cubo podría pasar de 0% a 100%. **Dos defensas**:
1. El sistema se autoldetiene en cuanto la etiqueta cruza el 75%.
2. En el peor caso (loop más rápido que el ciclo de respuestas), Meta nos devuelve 429 y el `RateLimitedError` reagenda con backoff exponencial.

---

## 8. Lo que tienes que hacer tú (operador)

Nada. El sistema lo gestiona solo:

- Lee la etiqueta de cada respuesta.
- La guarda en Redis.
- La consulta antes de cada llamada.
- Decide pasar / esperar / parar según el porcentaje.

Lo único que se te pide manualmente es:

1. **Mira `/admin/rate-limits` ocasionalmente**. La tarjeta `app:{app_id}` de la sección "Meta BUC mirror" debería estar siempre en verde (<50%). Si la ves en amarillo (50-75%) o rojo (>75%) sostenido, avísanos: querría decir que algún flujo nuevo está consumiendo más de lo previsto.

2. **Cuando aprobemos la app en Meta App Review** y subamos a Standard Access: el cubo crece automáticamente sin tocar nada. No se cambia código.

3. **Si conectamos cuentas tipo MotoGP**: nada. Como vimos, su trabajo no toca este cubo.

---

## 9. Resumen en 4 líneas

- Meta nos da **un único cubo de "200 × clientes activos hoy"** llamadas por hora.
- Casi nada de lo que hacemos lo toca: solo un puñado de endpoints específicos.
- El sistema lo lee de la etiqueta de cada respuesta y se autodetiene al 75%.
- En las últimas 24h hemos consumido **0%** de él. **Margen prácticamente infinito.**

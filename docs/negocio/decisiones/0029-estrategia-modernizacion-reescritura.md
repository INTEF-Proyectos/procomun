# ADR-0029 Estrategia de modernización: rechazar la reescritura completa y ejecutar simplificación incremental

* Estado: **Propuesto**
* Fecha: 2026-07-16
* Agentes Implicados: coordinación y gobernanza; arqueología de arquitectura; inventario funcional y de dominio; medición técnica; evaluación tecnológica; defensor de la reescritura; crítico de la reescritura; arquitectura incremental; datos y migraciones; seguridad, privacidad, ENS y accesibilidad; QA y validación; costes, entrega y operación; dos revisores adversariales independientes (@.agents/skills/evaluacion-tecnologica, @.agents/skills/arquitectura-solucion, @.agents/skills/qa-validacion, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/devops-sre, @.agents/skills/documentacion-y-roadmap)
* Caso de análisis completo: [`docs/casos/evaluacion-reescritura-plataforma/`](../../casos/evaluacion-reescritura-plataforma/README.md)

## Contexto y Problema

Procomún NG es un monorepo TypeScript/Bun de ~4 meses de vida (417 commits, 2026-03-24 → 2026-07-15) que implementa el MVP del sustituto de Procomún: catálogo público, flujo editorial con 5 roles, subidas TUS, pipeline .elpx completo con endurecimiento de seguridad, FTS PostgreSQL, colecciones, social ligero, i18n en 5 idiomas y backoffice. Se plantea si la plataforma debe mantenerse y refactorizarse, reorganizarse como monolito modular, sustituir tecnologías selectivamente, reescribirse incrementalmente (Strangler Fig), reescribirse por completo de forma mecánica, o reescribirse con rediseño — o si no hay evidencia para ningún cambio estructural.

La evaluación se hizo con una organización multiagente, mediciones reproducibles sobre el commit `eea2fe7d` y análisis crítico de cuatro fuentes externas (consultadas el 2026-07-16): la reescritura de Bun en Rust, el patrón Strangler Fig (Fowler y Microsoft) y «Things You Should Never Do» (Spolsky).

## Alcance y fuera de alcance

**Alcance**: la estrategia estructural de la plataforma NG (código, datos, calidad, límites de módulo). **Fuera de alcance**: la migración de contenidos desde el Procomún legacy (Drupal) — épica propia de Fase 2 donde el patrón Strangler sí tiene encaje NG↔legacy —, las decisiones de producto de Fase 2 pendientes de INTEF (comunidades, artículos, app móvil), y cualquier implementación (esta ADR es exclusivamente documental).

## Restricciones

Confirmadas por el encargo y por ADRs vigentes: TypeScript strict + Bun (ADR-0001), PostgreSQL producción + PGlite desarrollo (ADR-0005/0006; el papel actual de PGlite como base de desarrollo local es el repropósito documentado tras ADR-0017), Hono (ADR-0003), Drizzle (ADR-0006), Better Auth + RBAC 5 roles (ADR-0007/0008/0016), Vite (ADR-0018, ADR-0023 rechazada), ENS Categoría MEDIA (ADR-0015a), i18n Paraglide (ADR-0014), servicio canónico unificado (ADR-0021), seguridad .elpx (ADR-0026/0027), sin microservicios sin necesidad demostrable, sin cambios de tecnología por uniformidad. **Cuestionamientos, separados de la recomendación**: no se encontró ningún impedimento crítico verificable contra Bun, PostgreSQL o PGlite; el único matiz documentado es acotar el papel de PGlite (tests herméticos sí; añadir un job de CI contra PostgreSQL 17 real) sin retirarla.

## Línea base resumida (medida el 2026-07-16; detalle en `baseline.md`)

* **Tests reales y en verde**: 702 unit (29,5 s), cobertura 90,32 % (umbral 90), E2E chromium 54 pass / 17 skipped / 0 fail. Build frontend 1,7 s; bundle principal 92,56 kB gzip; API responde en 0,6 s.
* **Tres puertas de calidad rotas en silencio**: (1) el lint es un no-op — `biome@0.3.3` es un gestor de variables de entorno homónimo, no `@biomejs/biome`; (2) el format-check de CI resuelve al mismo binario equivocado; (3) `bunx tsc --noEmit` reporta **635 errores** y CI los ignora con `continue-on-error: true`. «TypeScript strict» nunca se ha cumplido como gate. *(Las puertas 1 y 2 fueron corregidas en la PR #272 tras esta evaluación — ver Adenda; la 3 sigue vigente.)*
* **Huecos de caracterización**: suite de integración **vacía** (0 tests); 0 tests de contrato de API; los 17 E2E saltados son `test.fixme` y cubren exactamente el camino editorial de escritura; los tests HTTP existentes simulan la autenticación; ~9 de 47 registros DEF de QA manual tienen regresión etiquetada.
* **Capa de datos con triple definición de esquema** (SQL a mano vivo en `setup.ts`; migraciones drizzle-kit muertas con journal desincronizado y colisión `0002_*`; tipos Drizzle) y **sin camino de upgrade** para BD con datos (el entrypoint de producción hace seed y «continúa si falla»). Deriva materializada dos veces: el hotfix jsonb (T-2026-06-24-002) y el hallazgo de esta evaluación — **la tabla de auditoría ENS `api_access_logs` solo la crea la migración muerta 0001; `setup.ts` no la crea (20 de 21 tablas), el middleware silencia los fallos de escritura por diseño y su test solo comprueba que no rompe la respuesta**, con lo que la traza de accesos puede no estar registrándose (verificación en runtime pendiente).
* **Tamaño y salud**: 29 653 LOC productivas en 220 archivos; 21 tablas; ~106 endpoints; 1 TODO; 0 reverts; 33 % de commits mencionan «fix»; sin usuarios ni despliegue de producción verificables (los datos son seed).
* **Gobernanza documental con deriva**: en el commit analizado, 32 archivos ADR para 28 entradas de índice (4 sin indexar); colisiones de numeración 0023/0024/0026 (además del par 0015, ya regularizado como 0015a/0015b en el índice); ADR-0026-FTS «Propuesto» pero implementada; 4 archivos con estado sin sincronizar frente al índice.

## Deuda técnica demostrada vs no demostrada

**Demostrada** (con comando o ruta): puertas de calidad rotas (lint/format corregidas en la PR #272; typecheck pendiente); suite de integración vacía y E2E de escritura en fixme; triple fuente de esquema sin upgrade path; dependencias vestigiales (pglite/drizzle/testing-library en frontend sin un solo import); dos drivers PostgreSQL; dos sistemas de auth sin puerto común; módulos que mezclan responsabilidades (`EditarPage.tsx` 799 líneas, `http-api-client.ts` 716 — hotspot de cambios); divergencias PGlite/PostgreSQL degradando en silencio (unaccent, GIN, PG15 en E2E vs PG17 en prod).

**NO demostrada**: problemas de rendimiento (ninguna medición los muestra); defectos atribuibles a Hono, Drizzle, Better Auth, React Router o Vite como tecnologías; imposibilidad de cambiar el sistema (el precedente interno demuestra lo contrario).

## Complejidad esencial vs accidental

* **Esencial (no desaparece reescribiendo)**: el flujo editorial multi-rol con sus matices, la seguridad de contenido de autor no confiable (.elpx: zip-slip/bomb, origen opaco, embeds), la interoperabilidad SCORM/IMS/EPUB/LOM-ES, i18n en 5 idiomas, ENS/RGPD, y la futura ingesta de ~79k ODEs. Cualquier implementación tendrá que soportar exactamente esto.
* **Accidental (eliminable in situ)**: puertas de calidad rotas (una línea de package.json + burndown), triple fuente de esquema (consolidación en `packages/db`), vestigios de la era Astro, dualidad de drivers, errores de tipos (3 tipologías mecánicas concentradas en `repository/*`), módulos mixtos. Ninguna de estas exige sustituir el sistema que las contiene.

## Opciones Consideradas

* **A — Mantener y refactorizar**: restaurar gates, limpiar vestigios, dividir módulos mixtos.
* **B — Monolito modular evolutivo**: A + fuente única de esquema con migraciones reales, puerto de auth, driver único, suite de caracterización (contract tests, integración, des-fixmear E2E), gates de arquitectura por grep en CI.
* **C — Sustitución tecnológica selectiva**: evaluada pieza a pieza; solo dos justificadas (biome real — en rigor reparación —, driver pg único), ambas subsumidas en A/B.
* **D — Strangler Fig interno**: descartada — contraindicada por la propia fuente del patrón para sistemas pequeños de reemplazo simple; no hay legacy que estrangular (NG *es* el reemplazo); coste fijo de fachada/coexistencia desproporcionado para ~30k LOC y 2 desarrolladores.
* **E — Reescritura completa mecánica con paridad**: el mejor caso defendible del agente defensor; exige construir primero el oráculo (3–8 semanas) + 2–5 meses con Fase 2 congelada.
* **F — Reescritura completa con rediseño**: sin defensa posible con datos — ni el propio agente defensor la sostuvo; invalida el único oráculo disponible; sin base de estimación.

## Matriz ponderada (detalle en `decision-matrix.md`)

26 criterios con pesos definidos antes de puntuar. Totales (máx. 270): **B 242 (90 %) > A 226 (84 %) > C 216 (80 %) ≫ D 142 (53 %) > E 132 (49 %) ≫ F 85 (31 %)**. El orden es robusto sin ponderar y ante perturbaciones de ±1 en cualquier peso. A, B y C no son excluyentes: B contiene a A e incorpora las dos sustituciones justificadas de C.

## Argumento más fuerte a favor de la reescritura (íntegro en `alternatives.md`)

La deuda encontrada es horizontal (tipos, lint, esquema, gates, dualidades) y atraviesa los 220 archivos — no se descompone en verticales estrangulables; el sistema está en su mínimo histórico de comportamiento a preservar (sin producción, sin datos reales, Fase 2 sin empezar) y esa ventana se cierra; la clase de defecto dominante (RBAC disperso, 47 DEF) se beneficiaría de recentralizar la matriz de permisos; el oráculo estaría «al 70 %» y completarlo es trabajo acotado porque `http-api-client.ts` ya enumera los contratos. **El propio defensor declaró las condiciones que tumban su caso**: que la reparación in situ resulte una fracción del portado (su «punto débil central», no medido), que el oráculo se complete antes de tocar nada, y que la operación no derive en rediseño.

## Argumento más fuerte en contra (íntegro en `alternatives.md`)

El objeto no tiene perfil de candidato: 4 meses, ~29,7k LOC, suite en verde, feedback de segundos, y **capacidad de cambio demostrada** — este equipo ya ejecutó una migración estructural mayor (Astro→React Router, ADR-0017/0018) de forma incremental y barata, y rechazó por escrito la última sustitución sin beneficio (ADR-0023). Procomún NG **ya es la reescritura** del legacy; reescribir la reescritura a los 4 meses destruiría el conocimiento codificado solo como correcciones (matices RBAC de 6+ defectos, IDOR, workarounds que el mismo stack volverá a necesitar) — exactamente el aviso de Spolsky y Fowler. Y los argumentos del defensor no distinguen caminos: los 635 errores de tipos hay que quemarlos igual en ambos; el coste previo de la reescritura (el oráculo) es el 80 % del valor de la vía incremental sin su riesgo.

## Interpretación crítica del caso Bun (obligatoria; detalle en `alternatives.md`)

El caso Bun (bun.sh/blog/bun-in-rust, 2026-07-08) cumplía condiciones que Procomún no cumple: (1) motivo sistémico ligado al lenguaje — clases de bugs de memoria de Zig eliminables en compilación por Rust; en Procomún el stack actual ES el objetivo aprobado y no existe clase de defecto que desaparezca reescribiendo TS→TS; (2) portado mecánico preservando arquitectura/interfaces/comportamiento, con el rediseño explícitamente diferido; (3) suite independiente del lenguaje de 1 386 826 aserciones como oráculo y cola de trabajo — Procomún tiene 2 066 aserciones mayormente acopladas a la implementación; (4) guías de portado, piloto de 3 archivos y ≥2 revisores adversariales por implementador; (5) «compilar no es funcionar»: paridad de 6 plataformas en verde y 0 tests borrados como condición de fusión — hoy inaplicable aquí (17 `fixme` conviven con el verde). La velocidad de generación de código nunca se consideró evidencia de corrección. **Usado con rigor, el artículo es un argumento para construir primero oráculo y piloto, no para reescribir.** Su lección transferible es metodológica y se incorpora a la vía incremental: oráculo independiente, revisión adversarial, gates de paridad, rediseño diferido.

## Big bang vs Strangler Fig

Big bang concentra el riesgo en el corte final y exige oráculo previo completo; Strangler amortiza riesgo por vertical pero paga fachada y coexistencia continuas — y Microsoft lo contraindica para sistemas pequeños de reemplazo simple, que es este caso. En ~30k LOC con suite en verde, la refactorización directa dentro del repositorio obtiene la incrementalidad del Strangler sin su coste fijo y la limpieza del big bang sin su riesgo. El Strangler se reserva para donde sí aplica: la coexistencia NG↔Drupal durante la ingesta legacy.

## Evaluaciones tecnológicas específicas (detalle en `technology-assessment.md`)

* **ORM**: un ORM no es imprescindible (FTS y esquema vivo ya son SQL), pero retirar Drizzle costaría la re-integración de Better Auth (`drizzleAdapter`) y el tipado sin beneficio medido. **Drizzle se mantiene**, condicionado a consolidar una única fuente de esquema con migraciones reales. Kysely/Prisma/`Bun.sql`/SQL directo: sin mejora demostrable medida; cambiar por uniformidad está vetado.
* **Framework HTTP**: **Hono se mantiene** — 0 incidencias atribuibles en 417 commits, acoplamiento encapsulado (fábrica CRUD, 13 líneas de composición), Better Auth agnóstico. Elysia/`Bun.serve`/Fastify: sin beneficio verificable.
* **Frontend y bundler**: **React Router + Vite se mantienen** — sin problema medido (build 919 ms, bundle 92,5 kB gzip) y con la alternativa ya rechazada en ADR-0023 por bloqueos vigentes. El coste real del frontend es interno (módulos mixtos, cliente HTTP monolítico) y se trata con límites, no con otro framework.
* **Modelo de datos**: 21 tablas adecuadas al dominio actual; el problema es la **gestión** del esquema (triple fuente, `api_access_logs` sin crear en el camino vivo, sin upgrade path, sin backup) — se corrige con migraciones versionadas y test de paridad `pg_dump` antes de la ingesta legacy, que es donde el esquema se estresará de verdad.

## Decisión

**Recomendación inequívoca: `Rechazar la reescritura completa y ejecutar simplificación incremental`.**

Materialización: programa por lotes 0–5 (opción B, que incluye A y las dos sustituciones justificadas de C) descrito en `alternatives.md` y en `implementation-agent-prompt.md`: (0) reparar lint/format y vestigios — **ejecutado en su mayor parte en la PR #272, ver Adenda**; (1) typecheck 635→0 con ratchet y gate; (2) suite de caracterización — des-fixmear los 17 E2E de escritura, contract tests black-box con login real, integración poblada, job PostgreSQL 17; (3) fuente única de esquema con migraciones versionadas, upgrade path y backup; (4) puertos y gates de arquitectura; (5) división de módulos mixtos. El piloto comparativo de `pilot-plan.md` (vertical Colecciones, dos brazos) queda diseñado para producir el único dato que podría reabrir esta decisión.

**Nivel de confianza: Alto** en rechazar E/F y D (fundado en 9 de los 14 gates del encargo sin cumplirse plenamente — 6 incumplidos de plano, 2 parciales, 1 dudoso —, matriz robusta, cuatro fuentes externas alineadas y precedente interno). **Medio** en el dimensionamiento exacto de los lotes (rangos de calendario con base de estimación limitada — sin histórico de velocidad del equipo).

## Ventajas medibles

Tabla completa de hipótesis H1–H12 (línea base → objetivo → método → gate) en `validation.md` §2. Destacadas: lint real bloqueante (H1), tsc 635→0 (H2), fuente única de esquema con diff `pg_dump` vacío (H3), 100 % de API pública con contract test black-box (H4), 17 fixme→0 (H5), integración >0 (H6), job PG17 (H7), matriz RBAC ejecutable (H10).

## Inconvenientes medibles

Tabla I1–I3 en `validation.md` §2: retraso posible de Fase 2 (gate de replanificación a 2× el rango), volumen desconocido de diagnósticos del primer lint real (gate a 1 semana), y renuncia al dato comparativo si el brazo 2 del piloto no se ejecuta (se hace constar).

## Riesgos y Mitigaciones

Los de la opción recomendada, sin minimizar (R1–R8 en `risks.md` §1): el lint/typecheck pueden destapar más trabajo del previsto (deseable pero costoso; presupuesto por lotes con gate 2×); riesgo de quedarse en lo barato y abandonar lo estructural (gates por lote escritos en CI); la conversión a login real puede destapar defectos de gates (precedente #221; contabilizar como hallazgos); coste de oportunidad frente a Fase 2 (lotes interrumpibles, lo que acelera Fase 2 va primero); tests de relleno inflando cobertura (medir también DEF por ronda); workaround del runner enmascarando fallos (deuda vigilada); deriva de esquema adicional antes del lote 3 (priorizarlo); ENS otra vez pospuesta (pregunta pendiente explícita).

## Plan piloto

Documental en `pilot-plan.md`: vertical Colecciones, oráculo primero (36–45 contract tests + 4 E2E des-fixmeados + goldens + PG17), brazo incremental vs brazo de regeneración mecánica timeboxed en worktree descartable con revisor adversarial; criterios de éxito, señal de replanteamiento (ventaja clara del brazo 2 → reabrir esta ADR) y de abandono; rangos: Fase 0 1–2 semanas, brazo 1 1–2 semanas, brazo 2 1 semana fija.

## Gates de decisión

Los 14 gates del encargo para recomendar reescritura completa están verificados uno a uno en `validation.md` §3: **hoy se cumplen 5 de 14** (alternativas evaluadas seriamente; inventario funcional; piloto diseñado; costes de transición identificados; revisiones adversariales de esta evaluación sin hallazgos críticos). Se incumplen de plano seis: sin problema estructural no resoluble incrementalmente (1, 3), sin suite de caracterización (5), sin contratos documentados (6), sin piloto ejecutado (8), sin criterios de aceptación ENS/a11y escritos (12); dos son parciales (9, 10) y una es dudosa (11).

## Estrategia de migración y de rollback

Sin migración de datos en la opción recomendada (el esquema no cambia; solo hay seed). El trabajo de datos es preventivo y queda como gate: migraciones versionadas con registro aplicadas en dev/E2E/prod, test de upgrade sobre BD con datos, tooling de backup/restore, y test de paridad de esquema PGlite↔PostgreSQL — todo ANTES de la ingesta legacy (~79k ODEs), que es la migración que de verdad importa (detalle en `migration-and-rollback.md`). Rollback de la opción recomendada: revert por lotes (cada lote deja el sistema en verde); del piloto: worktree descartable.

## Consecuencias

### Positivas

* El sistema recupera puertas de calidad reales (lint, format, typecheck) y una suite de caracterización que protege el comportamiento ganado a base de defectos.
* La capa de datos queda lista para la ingesta legacy (migraciones reales, upgrade path, backup) sin gastar el presupuesto de riesgo en una migración interna innecesaria.
* Fase 2 puede arrancar en paralelo o inmediatamente después de los primeros lotes; no hay ventana de congelación.
* Los límites y gates instalados (puertos, greps, contract tests) abaratan cualquier sustitución futura — la lección registrada de la migración Astro→React.
* Queda diseñado (no ejecutado) el experimento que produciría el único dato capaz de reabrir la decisión con evidencia.

### Negativas / Riesgos

* Se asume el coste de absorber 4 meses de diagnósticos acumulados (lint/tipos) sin conocer su volumen exacto.
* La deuda de gobernanza documental (colisiones ADR, estados desincronizados) queda identificada pero su corrección requiere decisión humana aparte.
* No se obtiene aún el dato comparativo reparar-vs-regenerar (solo con el piloto); la decisión descansa en el análisis de gates y matriz, no en un experimento ejecutado.
* Si INTEF cambiara el alcance de Fase 2 de forma sustancial, la matriz debería revisarse.

## Criterios de revisión de esta ADR

Revisar (sin necesidad de nueva evaluación completa) si: el brazo 2 del piloto muestra ventaja clara de la regeneración; algún lote excede 2× su rango de forma reiterada; aparece un impedimento crítico verificable contra Bun/PostgreSQL/PGlite; INTEF redefine el alcance de Fase 2; o NG entra en producción con datos reales antes de completar los lotes 0–3 (recalibrar riesgos de datos).

## Preguntas pendientes (requieren decisión humana)

1. ¿Se ejecuta el brazo 2 del piloto (regeneración timeboxed) para obtener el dato comparativo, o se asume el coste de no tenerlo?
2. ¿Quién decide y cuándo sobre la épica ENS estancada (0/12 tareas, fuera de `status.yaml`) y la verificación de CodeQL/Secret Scanning?
3. ¿Se aprueba la propuesta de regularización documental (renumerar ADRs duplicadas 0023/0024/0026, pasar ADR-0026-FTS a Aceptado, sincronizar estados supersedidos)? Esta ADR no la ejecuta.
4. ¿Qué formatos de preservación exige INTEF (F2-09) antes de diseñar la ingesta legacy?
5. ¿Cuál es el estado real de los 47 registros DEF cruzado con issues de GitHub? (los documentos de QA no marcan correcciones).
6. ¿Está registrándose realmente la auditoría de accesos en los entornos existentes? (la tabla `api_access_logs` no la crea el camino vivo de esquema; verificar en runtime y, si procede, tratar como incidencia ENS con prioridad).

## Referencias

* Caso completo: `docs/casos/evaluacion-reescritura-plataforma/` (baseline, inventario, arqueología, tecnología, alternativas, matriz, piloto, datos, validación, riesgos, prompt de ejecución).
* Bun: «Rewriting Bun in Rust» — https://bun.sh/blog/bun-in-rust (publicado 2026-07-08; consultado 2026-07-16).
* Martin Fowler: «Strangler Fig Application» — https://martinfowler.com/bliki/StranglerFigApplication.html (2024-08-22; consultado 2026-07-16).
* Microsoft Azure Architecture Center: «Strangler Fig pattern» — https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig (actualizado 2026-06-03; consultado 2026-07-16).
* Joel Spolsky: «Things You Should Never Do, Part I» — https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/ (2000-04-06; consultado 2026-07-16).
* ADRs internas: 0001, 0003, 0005, 0006, 0007, 0008, 0017, 0018, 0021, 0022, 0023 (rechazada), 0024 (exportación .elpx), 0025 (sin indexar en decision-log al cierre de esta evaluación), 0026, 0027, 0028.

## Notas de Implementación

No implementar nada hasta la aceptación humana de esta ADR. Tras la aceptación: ejecutar `docs/casos/evaluacion-reescritura-plataforma/implementation-agent-prompt.md` como prompt autónomo de la segunda fase (lotes 0–5 con implementador, dos revisores adversariales, agente corrector y validación humana por lote). Esta ADR no altera el estado de ninguna decisión vigente.

## Adenda 2026-07-16 — Ejecución adelantada parcial del Lote 0 (PR #272)

Por petición expresa del propietario del repositorio, la parte de riesgo cero del Lote 0 se ejecutó el mismo día en la **PR #272** (`fix/quality-gates-biome`), sin esperar a la aceptación de esta ADR: `@biomejs/biome` 2.4.8 real instalado, formateo y fixes seguros aplicados, errores de lint restantes resueltos (arreglos dirigidos + supresiones justificadas + 2 grupos de reglas rebajados temporalmente a warning con burn-down de 288 avisos), deps vestigiales del frontend retiradas y `test-regex.ts` eliminado. Validación de esa PR: suite 702 pass con cobertura ≥90 %, gate de lint verificado con error inyectado, `tsc` estable en 635 errores.

Efecto sobre esta ADR: **la recomendación no cambia; se refuerza.** La primera ejecución real del lint midió 111 errores/275 warnings/311 archivos sin formatear y su absorción completa costó **horas** — exactamente la medición que el defensor de la reescritura señalaba como su «punto débil central» (condición nº 1: si la reparación in situ resulta una fracción pequeña del portado, la reescritura pierde su base económica). Para la puerta de lint, esa condición se ha verificado en contra de la reescritura. Las hipótesis H1 e I2 de `validation.md` pasan a cumplidas/medidas; el resto del programa (typecheck, caracterización, esquema) sigue pendiente de la aceptación de esta ADR.

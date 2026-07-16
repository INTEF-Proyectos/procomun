# Plan de piloto (documental — NO implementar en esta fase)

* Fecha: 2026-07-16 · Commit base: `eea2fe7d`
* Propósito doble: (1) validar el programa incremental recomendado sobre una vertical real antes de generalizarlo; (2) producir el dato que falta en toda la evaluación — el coste comparado entre **reparar/caracterizar in situ** y **regenerar mecánicamente** la misma vertical — que es la condición nº 1 declarada por el propio defensor de la reescritura («si la reparación in situ cuesta una fracción pequeña del portado, la reescritura pierde su base económica»).

## 1. Vertical seleccionada: **Colecciones**

Justificación: es la vertical más pequeña que atraviesa todas las capas exigidas, sin arrastrar la complejidad singular del pipeline .elpx (que se caracteriza aparte y nunca debe pilotarse primero por su coste de seguridad):

| Capa exigida | Presencia en la vertical |
| --- | --- |
| Interfaz | `ColeccionesPage` (pública) + `CollectionsCrudIsland.tsx` (admin, 736 líneas — además candidata a división) |
| API | `GET /api/v1/collections[/:slug]` + CRUD `/api/admin/collections` + asociación/reordenación de recursos |
| Reglas de negocio | Publicación, portada, orden editorial (`collection_resources.position`), visibilidad por estado |
| PostgreSQL/PGlite | Tablas `collections`, `collection_resources`; consultas con JOIN y conteos |
| Autorización | RBAC con historia real: gestión reservada a curator/admin, con defecto corregido (#162/DEF-011) |
| Validación | Slugs, estados, payloads del CRUD |
| Pruebas | Tests existentes en `packages/db/src/repository.unit.test.ts` y rutas admin; 4 E2E de curator en `test.fixme` (`e2e/tests/curator/review.e2e.ts`) |
| Observabilidad | `activity_events` registra acciones; el piloto añade medición mínima de latencia por endpoint (sin dependencias nuevas: timestamps en test harness) |
| Datos | Seed determinista: 8 colecciones, 22 recursos (compatibilidad verificable por conteos y checksums) |

## 2. Comportamiento que debe preservarse (contrato del piloto)

1. Shape JSON exacto de `GET /api/v1/collections` y `GET /api/v1/collections/:slug` (claves, tipos, paginación) — la matriz funcional F2-01 prohíbe romper API pública/slugs.
2. Matriz de permisos de la vertical: reader/author sin acceso al CRUD; curator y admin con gestión completa (incluye la regresión #162: curator ve y gestiona colecciones creadas por admin).
3. Orden editorial estable tras reordenación (subir/bajar/quitar) y su reflejo público.
4. Comportamiento de colección no publicada: invisible en listado público.
5. Accesibilidad: axe wcag2a/aa sin violaciones critical/serious en `/colecciones` (gate existente).

## 3. Diseño experimental: dos brazos sobre la misma vertical

**Fase 0 — Oráculo primero (común a ambos brazos).** Construir la caracterización de la vertical ANTES de tocar nada: (a) tests de contrato HTTP black-box (login real vía `/api/auth/*`, sin `mockUser`) para los ~12–15 endpoints de la vertical, ~3 casos por endpoint (éxito con shape, 401/403 por rol, validación) ≈ 36–45 casos; (b) des-fixmear los 4 E2E de colecciones del curator; (c) golden responses (JSON canónico con el seed) capturadas de la implementación actual; (d) doble ejecución PGlite + PostgreSQL 17 real.

**Brazo 1 — Incremental in situ (el recomendado).** Sobre el repo: aplicar a la vertical los lotes del programa (tipos a 0 en sus archivos, división de `CollectionsCrudIsland`, `ApiClient` de colecciones como interfaz separada), manteniendo el oráculo en verde en cada paso.

**Brazo 2 — Regeneración mecánica (timeboxed).** En un worktree aislado que NO se fusiona: regenerar la vertical (repositorio + rutas + página + island) desde los contratos y el oráculo, sin mirar el código original más que para consulta de contratos («portado mecánico» en miniatura, estilo Bun), con un revisor adversarial separado del implementador. Medir: tiempo hasta oráculo en verde, defectos encontrados por el oráculo, defectos encontrados por revisión adversarial que el oráculo no vio.

## 4. Métricas y benchmarks del piloto

| Métrica | Método |
| --- | --- |
| Esfuerzo por brazo (horas-persona y calendario) | Registro diario simple; mismo equipo, brazos secuenciales para no contaminar |
| Defectos por brazo | Conteo de fallos del oráculo + hallazgos adversariales, clasificados |
| Paridad | % de golden responses idénticas (objetivo 100 %; diferencias solo si se aceptan explícitamente por escrito) |
| Latencia por endpoint (informativa) | Medición antes/después en el harness de contrato, mismo seed y máquina |
| Calidad estructural | Errores tsc de la vertical (línea base → 0), tamaño de módulos, imports fuera de límites |

## 5. Criterios de éxito y de abandono

**Éxito del piloto (brazo 1):** oráculo de la vertical al 100 % en verde en PGlite y PostgreSQL; 0 regresiones E2E; tipos de la vertical a 0 errores; esfuerzo dentro del rango previsto (§7). → Generalizar el programa incremental al resto de verticales.

**Señal de replanteamiento (condición del defensor):** si el brazo 2 alcanzara paridad total con un esfuerzo claramente inferior al brazo 1 (orientativamente, menos de la mitad, umbral a ratificar por la persona decisora antes de empezar) **y** con menos defectos residuales, la ADR-0029 debería reabrirse para reevaluar la opción E con este dato. Este umbral se justifica porque la reescritura completa añade costes que el piloto no captura (coexistencia, re-validación ENS, congelación de Fase 2): una ventaja pequeña del brazo 2 no bastaría.

**Abandono del piloto:** si la Fase 0 (oráculo) supera el doble de su rango estimado, detener y reportar — significaría que el coste de caracterización global está mal estimado y toda la planificación (de cualquier estrategia) debe revisarse.

## 6. Rollback

* Brazo 1: revert de los lotes (commits pequeños, cada paso deja verde).
* Brazo 2: el worktree se descarta; por diseño nunca toca `main`.
* Datos: no hay migración de datos en el piloto (el esquema de la vertical no cambia); el seed se regenera de cero en cada corrida.

## 7. Duración estimada (rango sobre trabajo identificable; no derivada de LOC)

| Fase | Unidades identificables | Rango calendario (equipo verificado: 2 devs a tiempo parcial + agentes) |
| --- | --- | --- |
| Fase 0 (oráculo) | 36–45 casos de contrato + 4 E2E + goldens + job PG17 | 1–2 semanas |
| Brazo 1 | ~15 archivos de la vertical, 3 lotes | 1–2 semanas |
| Brazo 2 (timeboxed) | regeneración de ~4 módulos contra oráculo | 1 semana fija (se corta al agotarse) |
| Análisis y decisión | informe comparado + actualización ADR | 2–4 días |

Supuestos: sin interrupciones de hotfix mayores; PostgreSQL 17 disponible en CI local/Docker; el timebox del brazo 2 es deliberado para acotar su coste (es un experimento de medición, no un entregable).

## 8. Incertidumbres declaradas

1. La conversión de tests con auth simulada a login real puede destapar defectos de composición de gates (como #221) — se contabilizarían como hallazgos, no como desviación.
2. Los 4 E2E `fixme` de curator pueden requerir corrección de producto además de test (los DEF de 26-may/02-jul sobre curator siguen sin corrección registrada) — si ocurre, se documenta y el esfuerzo se imputa aparte.
3. El brazo 2 con agentes IA puede ser artificialmente rápido en una vertical pequeña y no extrapolar a las verticales con integraciones (.elpx, TUS, OIDC) — limitación explícita del experimento; por eso su resultado solo *reabre* la ADR, no decide por sí solo.
4. No hay datos de producción: la latencia medida es informativa, no un SLO.

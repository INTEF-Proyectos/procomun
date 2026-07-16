# Validación: qué se ejecutó, hipótesis medibles y gates

* Fecha: 2026-07-16 · Commit: `eea2fe7d`

## 1. Comandos ejecutados durante esta evaluación (con resultado)

| Comando | Resultado |
| --- | --- |
| `git status --short` (antes de empezar) | Árbol limpio |
| `bun install --frozen-lockfile` | OK, 0,79 s |
| `bun run lint` | exit 0 en 0,60 s — **no-op demostrado** (paquete `biome` equivocado) |
| `bun run design:lint` | OK, 0,09 s |
| `bun run test` | **702 pass, 0 fail**, cobertura 90,32 %, 58,46 s |
| `bun run test:unit` / `test:integration` | 702 pass en 31 s / **0 tests** (suite vacía) |
| `bunx tsc --noEmit` | **635 errores** (CI lo ignora con `continue-on-error`) |
| `cd <ws> && bunx tsc --noEmit` ×4 | 366 (api) / 117 (cli) / 158 (frontend) / 218 (db) |
| `bun run --filter '@procomun/frontend' build` | OK, 1,69 s; bundle principal 92,56 kB gzip |
| `make ensure-exelearning-editor` + seed + `bun run dev` + `CI=1 bun run test:e2e` | E2E chromium: **54 pass, 17 skipped (`test.fixme`), 0 fail**, 62,8 s; API responde en 0,6 s |
| `bunx @biomejs/biome format .` (comando de CI) | exit 0 sin salida — resuelve al binario equivocado local (no-op) |
| `git diff --check` (antes de commit) | Ver PR — se ejecuta en la validación final |

Detalle completo y reproducción en `baseline.md`. No se modificó código productivo, dependencias ni lockfiles; los únicos artefactos generados fueron `dist/` y `local-data/` (ambos gitignorados).

## 2. Ventajas e inconvenientes medibles de la recomendación (hipótesis verificables)

Formato exigido: hipótesis → línea base → objetivo → método → gate → resultado. Umbrales justificados por coste: se exige llegar a cero solo donde el estado es binario (una puerta funciona o no); donde hay acumulación (tests, DEF) el objetivo se fija por lote para no inventar porcentajes atractivos.

| Hipótesis | Línea base (2026-07-16) | Objetivo | Método (reproducible) | Gate | Resultado |
| --- | --- | --- | --- | --- | --- |
| H1. El lint analiza código de verdad | no-op (`biome@0.3.3`) | `@biomejs/biome` real, 0 errores, paso bloqueante | `bun run lint` con el paquete correcto | exit ≠ 0 ante diagnósticos; verificable con un error inyectado | **Cumplida (PR #272)**: biome 2.4.8 con reglas recomendadas completas, 0 errores, sin rebajas ni supresiones nuevas; gate verificado con error inyectado (exit 1) |
| H2. El typecheck bloquea CI | 635 errores; `continue-on-error: true` | 0 errores; paso bloqueante | `bunx tsc --noEmit \| grep -c 'error TS'` | ratchet: el conteo nunca sube; al llegar a 0, retirar `continue-on-error` | pendiente |
| H3. Fuente única de esquema | 3 definiciones; journal desincronizado; colisión `0002_*` | 1 fuente + migraciones versionadas con registro aplicadas en dev/E2E/prod | diff de `pg_dump --schema-only` entre camino de migraciones y esquema actual, en PGlite y PG17 | diff vacío en ambos motores; test de upgrade sobre BD con datos | pendiente |
| H4. Contrato API caracterizado | ~50/106 handlers con ejercicio HTTP (auth simulada); 0 contract tests black-box | 100 % de la API pública (`/api/v1`, `/feeds`) con contract test black-box y login real | suite de contrato contra servidor levantado | 0 rupturas de shape no aceptadas explícitamente | pendiente |
| H5. E2E del camino de escritura activo | 17 `test.fixme` (registro, formulario, TUS, curator, admin) | 0 fixme; flujos editoriales en verde | `CI=1 bun run test:e2e` | ningún test borrado; skipped solo por condición de entorno documentada | pendiente |
| H6. Suite de integración real | 0 tests | ≥1 flujo multi-endpoint por dominio (login→crear→review→publish→GET público) | `bun run test:integration` | conteo > 0 y bloqueante | pendiente |
| H7. Paridad PGlite↔PostgreSQL cerrada | ramas unaccent/GIN silenciosas; E2E prueba PG15, prod usa PG17 | job de CI con la suite contra PG17 real | workflow con servicio postgres:17 | job en verde obligatorio en PR | pendiente |
| H8. Deps del frontend sin vestigios | 15 runtime (2 sin ningún import; testing-library sin uso) | 8 runtime | `bun -e` sobre package.json + grep de imports | 0 deps declaradas sin import | pendiente |
| H9. Módulo cliente HTTP deja de ser hotspot monolítico | `http-api-client.ts` 716 líneas, 23 cambios históricos | interfaz por dominios; ningún archivo >400 líneas en `lib/` | `wc -l`, revisión de estructura | tests de contrato del cliente intactos | pendiente |
| H10. Matriz de permisos como contrato ejecutable | matices RBAC dispersos en 7 suites; regresiones etiquetadas ~9/47 DEF | matriz rol×entidad×estado×acción ejecutada por HTTP con login real | suite de matriz | 100 % de celdas verificadas; 0 diferencias | pendiente |
| H11. La clase de defecto RBAC deja de recurrir | ≥10 DEF de autorización en 3 rondas de QA | tendencia a 0 DEF nuevos S1/S2 de autorización | siguiente ronda del plan MP-01–20 tras lotes 1–4 | comparación entre rondas (observacional; sin umbral duro — confianza media) | pendiente |
| H12. Los defectos enmascarados por tipos afloran y se corrigen | desconocido (por eso son enmascarados) | los errores TS2571/TS2532 de `repository/*` corregidos revelan N bugs reales, documentados | revisión de cada lote de tipos | cada bug real encontrado se anota en el informe del lote | pendiente |

**Inconvenientes medibles de la recomendación (también hipótesis):**

| Inconveniente | Línea base | Riesgo medible | Método | Gate de replanificación | Resultado |
| --- | --- | --- | --- | --- | --- |
| I1. El saneamiento retrasa Fase 2 | Fase 2 sin arrancar | lotes 0–2 exceden su rango (2–6 semanas) | registro de calendario por lote | >2× el rango → re-priorizar y reportar | pendiente |
| I2. El lint real inunda de diagnósticos | desconocida (nunca se ejecutó) | volumen de diagnósticos del primer run | primer `biome lint .` real | si exige >1 semana de absorción, tratarlo como lote propio con presupuesto | **Medida y resuelta (PR #272)**: 111 errores + 275 warnings + 311 archivos sin formatear; absorción completa con arreglos reales en ~1 día con agentes (por debajo del gate); los ~250 warnings restantes son niveles por defecto de las reglas recomendadas, solapados con el Lote 1 |
| I3. No se obtiene el dato comparativo con la reescritura | sin dato | el brazo 2 del piloto no se ejecuta | plan de piloto §3 | si se omite el brazo 2, la ADR lo hace constar y la reapertura pierde su vía objetiva | pendiente |

## 3. Gates para recomendar una reescritura completa (estado actual)

Verificación de las 14 condiciones del encargo — **hoy se cumplen 5 de 14** (las nº 2, 4, 7, 13 y 14); seis se incumplen de plano (1, 3, 5, 6, 8, 12), dos son parciales (9, 10) y una es dudosa (11):

| # | Condición | ¿Se cumple hoy? |
| --- | --- | --- |
| 1 | Problema estructural cuantificado | **No como problema de arquitectura**: lo cuantificado (lint no-op, 635 tsc, esquema triple) es de configuración/consolidación, corregible in situ |
| 2 | Alternativas incrementales evaluadas seriamente | **Sí** (este caso) |
| 3 | El problema no puede resolverse con menor riesgo incrementalmente | **No**: puede (lotes 0–5) |
| 4 | Inventario funcional suficientemente completo | **Sí** (`feature-inventory.md` + casos previos) |
| 5 | Suite de caracterización capaz de detectar pérdida de comportamiento | **No**: integración vacía, E2E de escritura en fixme, auth simulada |
| 6 | Contratos API y de datos documentados | **No**: sin contract tests ni spec de API |
| 7 | Piloto representativo diseñado | **Sí, documentado** (`pilot-plan.md`), no ejecutado |
| 8 | Piloto demuestra beneficios con método reproducible | **No** (no ejecutado) |
| 9 | Estrategia de migración de datos | Parcial (diseñada en `migration-and-rollback.md`; mecanismo de migración real inexistente) |
| 10 | Estrategia de rollback | Parcial (diseñada; sin tooling de backup probado) |
| 11 | Capacidad de mantener la versión vigente en paralelo | Dudosa (2 devs; QA activa con defectos nuevos por ronda) |
| 12 | Criterios de aceptación de seguridad/a11y/interop/ENS | **No escritos** (los gates de `risks.md`/informe de seguridad son propuesta, no criterios aceptados) |
| 13 | Costes de transición y arquitectura temporal identificados | **Sí** (informe de costes), con rangos de confianza baja |
| 14 | Revisores adversariales sin riesgos críticos pendientes | **Sí para esta evaluación documental**: dos revisiones independientes ejecutadas (lentes: métricas/reproducibilidad y coherencia/trazabilidad) sin ningún hallazgo crítico; los hallazgos ALTO/MEDIO se corrigieron en la propia rama. Para una futura propuesta de reescritura, la condición tendría que verificarse de nuevo sobre esa propuesta |

Conclusión: la reescritura completa está **bloqueada por los gates 1, 3, 5, 6, 8 y 12**; la recomendación no puede ser E ni F.

## 4. Validaciones documentales de esta entrega

* `status.yaml` y `decision-log.yaml` re-parseados tras la edición (YAML válido).
* `bun run design:lint` en verde (no afectado).
* `git diff --check` sin problemas de whitespace.
* Dos revisiones adversariales independientes ejecutadas sobre el diff y los artefactos (no sobre las justificaciones del redactor), con lentes separadas: métricas/reproducibilidad y coherencia/trazabilidad. Sus hallazgos (ninguno crítico) se corrigieron en commits posteriores de esta misma rama y se resumen en la descripción de la PR.

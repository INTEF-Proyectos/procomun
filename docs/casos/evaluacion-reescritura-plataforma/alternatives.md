# Alternativas evaluadas (A–F)

* Fecha: 2026-07-16 · Commit: `eea2fe7d`
* Este documento desarrolla las seis opciones, el mejor argumento a favor y en contra de la reescritura (elaborados por agentes adversariales separados que no revisaron el trabajo del otro), y la interpretación crítica del caso Bun.
* Fuentes externas consultadas el 2026-07-16 vía WebFetch: bun.sh/blog/bun-in-rust (publicado 2026-07-08), martinfowler.com/bliki/StranglerFigApplication.html (2024-08-22), learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig (actualizado 2026-06-03), joelonsoftware.com «Things You Should Never Do, Part I» (2000-04-06).

## Opción A — Mantener y refactorizar

Simplificación dentro de la arquitectura vigente. Trabajo identificado con rutas concretas:

1. **Restaurar puertas de calidad** (máximo retorno de todo el análisis). *Parte de lint/format: **ya ejecutada en la PR #272** tras esta evaluación — biome real 2.4.8 y absorción completa de los diagnósticos (111 errores/275 warnings/311 archivos sin formatear) con arreglos reales de código, sin rebajas de reglas ni supresiones nuevas, en ~1 día con agentes.* Queda el typecheck: quemar los 635 errores por tipología — `TS2571` concentrado en `packages/db/src/repository/*` (patrón único: retornos de `db.execute(sql\`...\`)` sin tipar, se resuelve una vez en `shared.ts` y se propaga), `TS2532/TS2538` (guards de acceso indexado), `TS7006` (anotar parámetros de tests). Ratchet en CI (fallar si el conteo sube) hasta llegar a 0 y entonces retirar `continue-on-error`.
2. **Limpieza de vestigios**: retirar `@electric-sql/pglite` y `drizzle-orm` del `apps/frontend/package.json` (0 imports); mover `typescript`, `@types/*`, `@testing-library/*` a devDependencies (o retirar testing-library, sin uso); corregir el comentario de `api-client.ts:3`. Renombrar `islands/`: aplazado (ruido de diff en ~112 archivos frente a beneficio cosmético).
3. **Módulos grandes**: dividir solo los que mezclan responsabilidades — `EditarPage.tsx` (799 líneas: workflow + uploader + editor eXe + formulario; hotspot de DEF) y la interfaz `ApiClient` por dominios (`http-api-client.ts`, 716 líneas, el hotspot de cambios del repo). `seed-data.ts` (831) son datos, se deja.

* Coste (rango del informe de costes): 2–6 semanas de calendario con el equipo verificado (2 desarrolladores + agentes). Coexistencia, migración de datos y mantenimiento paralelo: cero.
* Métricas objetivo: tsc 635→0 con gate bloqueante; lint real en verde; deps runtime frontend 15→8.
* Límite: no mejora por sí sola la capacidad de entregar Fase 2; no toca la gestión del esquema.

## Opción B — Monolito modular evolutivo

A + consolidación de límites, sin segundo producto. Los seams **ya existen** en parte (precedente: particiones de `admin.ts` y `repository.ts` completadas en días según `status.yaml` T-2026-03-28-002, T-2026-03-31-001/003):

| Seam | Estado |
| --- | --- |
| Fachada de repositorios por dominio (`packages/db/src/repository.ts`) | Vigente; las queries reciben la instancia como parámetro |
| Fábrica CRUD (`apps/api/src/routes/crud-builder.ts`) | Aísla ~80 % del CRUD admin del framework |
| Interfaz `ApiClient` + factory (`get-api-client.ts`) | El seam que hizo barato retirar `PreviewApiClient` |
| Auth handler fetch-estándar | Better Auth ya es agnóstico del router |

Trabajos nuevos: (1) **fuente única de esquema** — sobrevive `schema/*.ts` como verdad de tipos + migraciones drizzle-kit regeneradas como evolución, `setup.ts` pasa a derivado; verificación por diff de `pg_dump --schema-only` entre ambos caminos en PGlite y PostgreSQL (contract test de esquema, hoy inexistente); el entrypoint Docker pasa de «seed crea tablas y continúa si falla» a migraciones versionadas con registro. (2) **Puerto de auth** (`auth/port.ts`) que encapsule `ensureCurrentUser`/`requireRole`/sync — el precedente DEF-019 (hubo que alcanzar `auth.$context.password.hash`) muestra el coste de no tenerlo. (3) **Driver pg único** (retirar `postgres` npm del seed). (4) **Gates de arquitectura por grep en CI**: `hono` importado solo bajo `routes/`+`app/`; `drizzle-orm` solo en `packages/db`+`db.ts`; `fetch(` prohibido en componentes (solo vía `ApiClient`) — la generalización de la lección Astro→React (islands con 0 imports de `astro` hicieron barata la sustitución).

* Coste: 4–10 semanas calendario incrementales, entregable por dominios, interrumpible.
* Métricas objetivo: gates de grep en 0; una fuente de esquema con test de paridad; drivers pg 2→1; upgrade path de BD probado sobre datos preexistentes.

## Opción C — Sustitución tecnológica selectiva

Evaluada pieza a pieza en `technology-assessment.md` §10. Resultado: **una sola sustitución obligada** (`biome` real — en rigor una reparación, no un cambio de tecnología; **ya ejecutada en la PR #272**) y **una consolidación** (driver pg único, pendiente). Hono, Drizzle, Better Auth, React Router y Vite no superan el listón de evidencia que el propio repositorio estableció al rechazar ADR-0023 (Vite→Bun): ninguna tiene coste medido que la sustitución elimine. PGlite se mantiene (restricción de producto y valor real: 702 tests en ~30 s sin Docker) acotando su papel: tests herméticos sí; y añadir un job de CI contra PostgreSQL 17 real para cerrar las ramas `unaccent`/GIN y la brecha de versiones (E2E hoy prueba v15, producción usa v17).

## Opción D — Strangler Fig

**No aplica a Procomún NG como estrategia de código, y las dos fuentes del patrón lo dicen.** Microsoft lista como caso donde el patrón «podría no ser adecuado»: *«You migrate a small system and replacing the whole system is simple»*. Procomún NG tiene ~29,7k LOC productivas (el caso Bun: 535k), un solo despliegue (ADR-0021), acceso completo al código y build de 1,7 s: el andamiaje de fachada, enrutado dual y doble operación es un coste fijo grande en proporción al sistema, a cambio de mitigar un riesgo (no poder tocar el legacy) que aquí no existe. Además **no hay legacy que estrangular: NG es el reemplazo del legacy** (Drupal/Java), con 4 meses de vida.

Donde el patrón SÍ tiene encaje futuro: la **coexistencia NG↔Procomún legacy durante la migración de contenidos** (~78 800 ODEs, F2-07) — fachada de catálogo, redirecciones y retirada progresiva del Drupal. Eso pertenece a la épica de migración de Fase 2, no a la estrategia interna de NG.

## Opción E — Reescritura completa mecánica (paridad antes de cualquier rediseño)

El mejor argumento a favor (agente defensor, resumen fiel):

* La deuda encontrada es **horizontal** (tipos, lint, esquema, gates, dualidades auth/driver) y atraviesa los 220 archivos; Strangler descompone verticales, no cimientos transversales.
* La clase de defecto dominante en QA es RBAC disperso; una regeneración con paridad permitiría centralizar la matriz de permisos como artefacto único testeable.
* El sistema está en su **mínimo histórico de comportamiento a preservar** (Fase 2 sin empezar, sin datos reales de producción — verificado: no hay workflow de deploy a servidor ni URL pública de NG; los datos son seed). La ventana barata para regenerar es ahora y se cierra al entrar datos reales.
* El oráculo de paridad está «al 70 %»: 54 E2E black-box + plan manual MP-01–20 + seed determinista; el hueco (contract tests de 106 endpoints) es trabajo acotado porque `http-api-client.ts` ya enumera todos los contratos consumidos.
* Condiciones declaradas por el propio defensor sin las cuales su argumento cae: que el piloto demuestre que la reparación in situ es una fracción pequeña del portado (su «punto débil central»); que el oráculo se complete ANTES de sustituir código; que no haya datos reales; que los invariantes de seguridad se re-verifiquen; que no se convierta en Opción F.

Coste (informe de costes): 3–8 semanas de construcción de oráculo previas + 2–5 meses de reimplementación con paridad (supuestos explícitos: 2 devs + agentes, mismas tecnologías), con Fase 2 congelada y toda corrección pagada dos veces durante la ventana.

## Opción F — Reescritura completa con rediseño simultáneo

**Nadie la defendió con datos** — ni siquiera el agente defensor, que la declaró indefendible de partida: las restricciones del encargo (Bun, PostgreSQL, PGlite, requisitos aceptados) la excluyen, no existe evidencia que justifique cambiar arquitectura y comportamiento a la vez, y al cambiar el comportamiento objetivo se invalida el único oráculo disponible (la suite actual). El caso Bun hizo explícitamente lo contrario (rediseño diferido a después de la paridad). Sin base de estimación de duración: cualquier cifra sería inventada. Se mantiene en la matriz como referencia de máximo riesgo.

## El mejor argumento en contra de la reescritura (agente crítico, resumen fiel)

1. **El objeto no tiene perfil de candidato**: 4 meses de vida, ~29,7k LOC, 702 tests en verde, feedback de segundos, 1 TODO, y capacidad de cambio demostrada (la migración Astro→React Router se ejecutó incrementalmente el mismo trimestre; la única sustitución sin beneficio demostrado, Vite→Bun, se rechazó por escrito).
2. **Procomún NG ya es la reescritura** (del legacy Drupal/Java). Reescribir la reescritura a los 4 meses, con la migración de ~79k ODEs pendiente, es abandonar un edificio a medio construir.
3. **Lo que se destruiría**: el conocimiento codificado solo como correcciones — matices RBAC de 6+ defectos, IDOR corregidos, workarounds de plataforma (que una implementación nueva **sobre el mismo stack** volvería a chocar), compatibilidad de URLs. Los 47 DEF son la prueba de Fowler: *«often it's hard to figure out the details of existing behavior»*.
4. **Los argumentos del defensor no distinguen caminos**: los 635 errores de tipos hay que quemarlos igual en ambos caminos (mismo `tsconfig`); el lint roto es un typo de dependencia de una línea; la triple fuente de esquema se consolida en `packages/db` sin tocar API ni frontend. El error count mide trabajo pendiente de tipado, no ventaja de reescribir.
5. **El coste previo de la reescritura (construir el oráculo) es el 80 % del valor de la opción incremental, sin su riesgo.**
6. Evidencia que haría cambiar de posición al crítico: problema sistémico ligado a plataforma medido y no corregible in situ; oráculo de paridad real en verde; piloto medido con mejora ≥ coste; intentos documentados y fallidos de la vía barata; cambio externo de restricciones de stack.

## Interpretación crítica del caso Bun (obligatoria)

Lo que el caso Bun fue (fuente: bun.sh/blog/bun-in-rust, consultado 2026-07-16; citas textuales en el informe de referencias):

1. **Motivo sistémico ligado al lenguaje**: clases enteras de bugs (use-after-free, double-free, fugas) propias de mezclar GC de JavaScript con memoria manual de Zig; Rust las convierte en errores de compilación («Compiler errors are a better feedback loop than a style guide»).
2. **Portado mecánico, no rediseño**: «A mechanical port from Zig to Rust, with the minimal number of behavioral changes»; el refactor idiomático se difirió explícitamente a después de la paridad.
3. **Se preservaron arquitectura, rendimiento, interfaces y funcionalidad**; el nuevo código «feels very similar to the old Zig codebase».
4. **Suite independiente del lenguaje como pieza central**: 1 386 826 aserciones, 60 624 tests en TypeScript (agnósticos al runtime), 0 tests borrados; sirvió de red de seguridad y de cola de trabajo.
5. **Guías y pilotos previos**: `PORTING.md`, `LIFETIMES.tsv`, piloto de 3 archivos; **revisión adversarial** con ≥2 revisores por implementador, contextos separados, incentivos asimétricos («assume the code is wrong»).
6. **La velocidad de generación no se consideró corrección**: bugs cazados antes de fusionar aunque todo compilaba (use-after-free en cierre asíncrono, truncamiento de timespec, `unwrap_or` ansioso).
7. **Compilar no era funcionar**: jerarquía compilación → smoke → suite local → **6 plataformas de CI en verde** como condición de fusión.
8. Datos: 11 días, 535k LOC origen, ~165 000 $ de cómputo, 19 regresiones conocidas post-fusión (corregidas), frente a una estimación manual de ~1 año × 3 ingenieros.

Transferibilidad a Procomún, condición por condición:

| Condición Bun | ¿Procomún la cumple hoy? |
| --- | --- |
| Motivo sistémico ligado al lenguaje/stack | **No**: el stack actual ES el stack objetivo aprobado (TS/Bun/PG); no hay clase de defecto que desaparezca reescribiendo TS→TS. Los defectos medidos son de configuración (lint, tipos, esquema) y de lógica de dominio (RBAC) |
| Suite independiente de la implementación | **No**: 2 066 aserciones (×671 menos), mayormente acopladas (imports de módulos, auth simulada); integración vacía; E2E de escritura en `fixme` |
| Operación planteada como portado mecánico | Solo la Opción E lo cumpliría; cualquier deriva hacia rediseño (F) anula la analogía |
| Guías de portado, piloto, revisiones adversariales | No existen artefactos equivalentes |
| Paridad como gate de avance | Inaplicable sin oráculo; hoy hay 17 tests `fixme` conviviendo con el verde (Bun toleraba 0) |
| Coste conocido y acotado | Sin piloto propio, cualquier cifra sería inventada |

**Conclusión de la interpretación**: el artículo de Bun, leído completo, enumera precondiciones que Procomún no cumple; usado con rigor es un argumento para **construir primero el oráculo y el piloto**, no para reescribir ya. La lección transferible positiva es metodológica: oráculo independiente + revisión adversarial + paridad como gate + rediseño diferido — aplicable igualmente (y con menos riesgo) a la vía incremental.

## Big bang vs Strangler Fig (comparación pedida)

* **Big bang (E/F)**: un solo corte final; exige oráculo completo antes de empezar, mantiene dos sistemas toda la ventana, concentra el riesgo en la retirada. En Procomún: sin usuarios de producción el corte es barato *hoy*, pero el oráculo no existe y su construcción es la partida dominante.
* **Strangler Fig (D)**: retira riesgo por vertical y entrega valor temprano (Fowler), pero paga fachada+coexistencia de forma continua; contraindicado por Microsoft para sistemas pequeños de reemplazo simple — exactamente este caso.
* **Tercera vía real (A/B/C)**: en un sistema de este tamaño con suite en verde, la refactorización directa dentro del repositorio obtiene las ventajas de ambos (incrementalidad, reversibilidad, sin coexistencia) sin el coste fijo de ninguno. Es además el patrón que este equipo ya ejecutó con éxito dos veces (particiones de `admin.ts` y `repository.ts`; migración Astro→React por etapas).

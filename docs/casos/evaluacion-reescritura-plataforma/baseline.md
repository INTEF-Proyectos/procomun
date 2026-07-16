# Línea base técnica reproducible

* Fecha de medición: 2026-07-16
* Commit analizado: `eea2fe7d1e26d2c614bf245491956e805416e251` (rama `main`)
* Entorno: macOS (Darwin 25.3.0), Bun 1.3.14, dependencias instaladas con `bun install --frozen-lockfile`
* Regla: toda cifra de este documento procede de un comando ejecutado en este entorno. Lo que no pudo medirse figura como «No medida» con el motivo.

## 1. Instalación, lint y tests

| Métrica | Valor | Comando | Notas |
| --- | --- | --- | --- |
| `bun install --frozen-lockfile` | 0,79 s | `/usr/bin/time -p bun install --frozen-lockfile` | Caché caliente; instaló 32 paquetes sobre `node_modules` preexistente |
| `bun run lint` | 0,60 s, exit 0 | `/usr/bin/time -p bun run lint` | **No-op** — ver sección 6 |
| `bun run design:lint` | 0,09 s, exit 0 | `/usr/bin/time -p bun run design:lint` | «DESIGN.md contract is aligned with required project tokens.» |
| `bun run test` (suite completa) | 58,46 s total; 29,51 s la ejecución de tests | `/usr/bin/time -p bun run test` | **702 pass, 0 fail**, 2 066 `expect()`, 78 archivos; incluye check-test-files + unit + integration + coverage |
| Cobertura de líneas | 90,32 % | salida de `bun run test` (`check-coverage`) | Umbral configurado: ≥ 90 % |
| `bun run test:unit` | 31,02 s; 702 pass, 0 fail | `/usr/bin/time -p bun run test:unit` | Toda la suite es unitaria |
| `bun run test:integration` | 0,02 s; **0 tests** | `/usr/bin/time -p bun run test:integration` | **La suite de integración está vacía** (no existe ningún `*.integration.test.ts`) |
| E2E chromium | 62,83 s; 71 tests: **54 pass, 17 skipped, 0 fail** | `CI=1 bun run test:e2e` con seed previo y `bun run dev` levantado | 1 worker por `CI=1`; requiere editor eXeLearning descargado |
| E2E firefox/webkit/mobile | No medida | — | Solo se ejecutó el proyecto chromium; los demás proyectos existen en `playwright.config.ts` |

Preparación medida del entorno E2E: `make ensure-exelearning-editor` 3,86 s (editor ya descargable de release); seed PGlite `bun run --filter '@procomun/cli' cli -- seed` 3,61 s.

## 2. Comprobación de tipos

| Configuración | Errores `error TS` | Comando |
| --- | --- | --- |
| Raíz (comando que ejecuta CI) | **635** en 22,4 s | `bunx tsc --noEmit` |
| `apps/api` (tsconfig propio) | 366 | `cd apps/api && bunx tsc --noEmit` |
| `apps/cli` | 117 | ídem |
| `apps/frontend` | 158 | ídem |
| `packages/db` | 218 | ídem |

Distribución de los 635 errores de la configuración raíz: 185 `apps/api`, 239 `apps/frontend`, 193 `packages/db`, 10 `e2e`, 3 `apps/cli`, 5 `scripts`. Tipología dominante observada: `TS2571 Object is of type 'unknown'`, `TS2532 possibly undefined`, `TS7006 implicit any` — coherentes con `strict: true` + `noUncheckedIndexedAccess: true` del `tsconfig.json` raíz.

Hecho relevante: el paso «Type Check» de `.github/workflows/ci.yml` ejecuta este comando con `continue-on-error: true`, de modo que **el typecheck nunca bloquea CI**. El código no compila limpio bajo ninguna de las configuraciones probadas. Bun ejecuta los tests eliminando tipos sin comprobarlos, por eso la suite está en verde a pesar de esto.

## 3. Tamaño y estructura

| Workspace | LOC productivas (.ts/.tsx sin tests) | Archivos productivos | LOC de test | Archivos de test |
| --- | ---: | ---: | ---: | ---: |
| `apps/api` | 6 039 | 57 | 7 091 | 48 |
| `apps/cli` | 1 763 | 9 | 138 | 3 |
| `apps/frontend` | 17 168 | 113 | 2 793 | 30 |
| `packages/db` | 3 971 | 36 | 697 | 6 |
| `scripts` | 712 | 5 | 252 | 5 |
| `e2e` | (104 LOC en 3 archivos auxiliares no-test: utils/fixtures, excluidos del total productivo) | — | 722 | 12 |
| **Total** | **29 653** | **220** | **11 693** | **104** |

Comando: `find <ws> -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/static/*' ! -path '*/public/*' -exec cat {} + | wc -l` (y equivalente para tests, incluyendo `*.e2e.ts`).

Otras dimensiones:

| Métrica | Valor | Comando/fuente |
| --- | --- | --- |
| Handlers HTTP con ruta literal en `apps/api` | 106 | `grep -rE '\.(get|post|patch|delete|put)\("' apps/api/src` excluyendo tests |
| Rutas frontend (React Router) | 12 rutas hoja + `admin/*` + variante localizada `:locale/*` | `apps/frontend/src/App.tsx:39-65` |
| Tablas (`pgTable`) | **21** | `grep -rh 'pgTable(' packages/db/src --include='*.ts' \| grep -v test \| wc -l` (nota: un primer conteo con regex `pgTable\("` dio 19 porque `ratings` y `favorites` declaran el nombre en la línea siguiente; el valor correcto es 21) |
| Tablas creadas por la fuente viva (`setup.ts`) | **20** | `grep -c 'CREATE TABLE IF NOT EXISTS' packages/db/src/setup.ts` — falta `api_access_logs`, que solo crea la migración muerta `0001_needy_stellaris.sql` |
| Migraciones SQL | 5 archivos, con **colisión de numeración** (`0002_add_downloads_format.sql` y `0002_text_to_jsonb_metadata.sql`) | `ls packages/db/migrations/` |
| `TODO/FIXME/HACK/XXX` en código propio | **1** | `grep -rnE 'TODO|FIXME|HACK|XXX' apps packages scripts --include='*.ts' --include='*.tsx' \| grep -v node_modules \| grep -v '/static/'` (la exclusión de `/static/` descarta el editor eXeLearning vendorizado; sin exclusiones el conteo bruto es mayor). El único marcador: `CatalogIsland.tsx:354` |
| Commits | 417, de 2026-03-24 a 2026-07-15 (~4 meses) | `git log --oneline | wc -l` |

## 4. Dependencias

| Workspace | Runtime | Dev |
| --- | ---: | ---: |
| raíz | 2 (`@electric-sql/pglite`, `drizzle-orm`) | 5 (`@axe-core/playwright`, `@types/bun`, `@playwright/test`, `biome`, `typescript`) |
| `apps/api` | 11 (`hono`, `better-auth`, `drizzle-orm`, `@electric-sql/pglite`, `@tus/server`, `@tus/file-store`, `cheerio`, `mammoth`, `pdf-parse`, `feed`, `@procomun/db`) | 0 |
| `apps/cli` | 4 (`@electric-sql/pglite`, `@procomun/db`, `better-auth`, `postgres`) | 0 |
| `apps/frontend` | 15 (react, react-dom, react-router-dom, `@inlang/paraglide-js`, `@uppy/{core,dashboard,tus}`, `@testing-library/{dom,react}`, `@types/react{,-dom}`, typescript, drizzle-orm, `@electric-sql/pglite`, `@procomun/db`) | 2 (`vite`, `@vitejs/plugin-react`) |
| `packages/db` | 3 (`drizzle-orm`, `@electric-sql/pglite`, `@faker-js/faker`) | 2 (`drizzle-kit`, `postgres`) |

Paquetes resueltos en `bun.lock` (directos + transitivos): **460**.

Observaciones factuales: `@testing-library/*`, `@types/*` y `typescript` figuran como dependencias runtime del frontend en lugar de dev; `drizzle-orm` y `@electric-sql/pglite` se repiten en 4 workspaces más la raíz; `@faker-js/faker` (solo seed) es dependencia runtime de `packages/db`.

## 5. Build y arranque

| Métrica | Valor | Comando |
| --- | --- | --- |
| Build frontend (Vite) | 1,69 s total (919 ms el paso de Vite) | `/usr/bin/time -p bun run --filter '@procomun/frontend' build` |
| Tamaño `dist/` | 1,1 MB | `du -sh apps/frontend/dist` |
| Bundle JS principal | 298,48 kB (92,56 kB gzip) `index-*.js` | salida de Vite |
| Chunk mayor secundario | 113,84 kB (33,58 kB gzip) `resource-uploader-*.js` (Uppy) | salida de Vite |
| Arranque API (dev, PGlite) hasta primera respuesta HTTP | **0,6 s** | polling `curl` a `http://localhost:3000/api/v1/resources` tras `bun run dev` |
| Arranque frontend dev (Vite) hasta primera respuesta | 1,16 s | polling `curl` a `http://localhost:5173/` |
| Arranque API en modo producción/imagen Docker | No medida | No se construyó la imagen Docker en esta evaluación |

## 6. Estado real de las puertas de calidad

Hallazgo central de esta línea base:

1. **El linter es un no-op.** La dependencia raíz `"biome": "0.3.3"` no es `@biomejs/biome` (el linter), sino un paquete homónimo antiguo cuya descripción es «A simple way to manage environment variables on a per-project basis». Su binario `biome` acepta `lint .` sin error y sale con código 0 sin analizar nada. Verificación: `./node_modules/.bin/biome --help` muestra subcomandos `init/add/use` de gestión de variables de entorno.
2. **El format-check de CI también es un no-op.** `bunx @biomejs/biome format .` resuelve al binario local `biome` ya presente en `node_modules/.bin` (mismo nombre de binario), devuelve 0.3.3 como versión y sale 0 sin salida. Ni `@biomejs` existe en `node_modules` (`ls node_modules/@biomejs` → no existe).
3. **El typecheck no bloquea.** `continue-on-error: true` en CI con 635 errores presentes (sección 2).
4. Las puertas **operativas de verdad** son: paridad archivo-test (`scripts/check-test-files.ts`), la suite de tests de Bun (702 tests) y el umbral de cobertura ≥ 90 % (`scripts/check-coverage.ts`), más el E2E de Playwright en PRs (workflow `e2e.yml`).

Consecuencia metodológica: las menciones «biome lint OK» repetidas en `status.yaml` no aportan evidencia de calidad, porque el comando nunca analizó código. Este hecho no invalida la suite de tests, que sí es real y está en verde.

**Actualización 2026-07-16 (posterior a la medición):** los puntos 1 y 2 quedaron **corregidos en la PR #272** (`fix/quality-gates-biome`), ejecutada tras esta evaluación como adelanto del Lote 0: `@biomejs/biome` 2.4.8 real instalado, formateo y fixes seguros aplicados (~330 archivos), errores restantes resueltos con arreglos dirigidos y supresiones justificadas, y dos grupos de reglas (deps de hooks React y a11y profunda) rebajados temporalmente a warning con burn-down explícito de 288 avisos. La primera ejecución real midió 111 errores de lint, 275 warnings y 311 archivos sin formatear; la absorción completa costó **horas, no semanas** (por debajo del gate de 1 semana de la hipótesis I2). El punto 3 (typecheck con 635 errores y `continue-on-error`) sigue vigente. Las cifras del resto de este documento describen el commit analizado `eea2fe7d`, anterior a esa corrección.

## 7. Métricas no medidas

| Métrica | Motivo |
| --- | --- |
| Duración de tests de integración | La suite existe como categoría pero contiene 0 tests |
| Dependencias circulares | No hay herramienta en el repo para medirlas y la instrucción prohíbe añadir dependencias; no se midió |
| Duplicación de código cuantificada | Mismo motivo (sin herramienta tipo jscpd en el repo); las duplicaciones observadas se describen cualitativamente en `technology-assessment.md` |
| Tiempo de cambios representativos (lead time) | No hay datos históricos fiables de esfuerzo por cambio en el repositorio |
| Frecuencia de regresiones normalizada | Los defectos DEF-XXX de QA manual existen (47 registros en 3 rondas) pero no hay denominador de uso que permita una tasa; se reportan en bruto en `feature-inventory.md` |
| Rendimiento bajo carga de la API | No hay benchmark de carga en el repo; no se improvisó uno para no fabricar cifras |
| Arranque API producción (imagen Docker) | No se construyó la imagen en esta evaluación |

## 8. Reproducción

```bash
git checkout eea2fe7d
bun install --frozen-lockfile
/usr/bin/time -p bun run lint
/usr/bin/time -p bun run design:lint
/usr/bin/time -p bun run test
/usr/bin/time -p bun run test:unit
/usr/bin/time -p bun run test:integration
bunx tsc --noEmit | grep -c 'error TS'
bun run --filter '@procomun/frontend' build
make ensure-exelearning-editor && bun run --filter '@procomun/cli' cli -- seed
bun run dev &   # esperar a que respondan :3000 y :5173
CI=1 bun run test:e2e
```

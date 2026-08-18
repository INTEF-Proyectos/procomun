# ADR-0040 Dependabot con ecosistema Bun y workspaces del monorepo

* Estado: Aceptado
* Fecha: 2026-08-18
* Agentes Implicados: [@.agents/skills/evaluacion-tecnologica], [@.agents/skills/devops-sre], [@.agents/skills/qa-validacion], [@.agents/skills/documentacion-y-roadmap]
* Fuentes: Context7 `/github/docs`, `/dependabot/dependabot-core`, `/websites/bun_sh`; documentación oficial de GitHub (agosto 2026)

## Contexto y Problema

El repositorio usa TypeScript + Bun (ADR-0001) con workspaces (`apps/*`, `packages/*`) y un único lockfile `bun.lock`. Dependabot estaba configurado con `package-ecosystem: npm`. Ese ecosistema actualiza `package.json` y no regenera `bun.lock`, así que CI y Docker fallan con *lockfile had changes, but lockfile is frozen* (PRs #131, #300 y el workflow paliativo `dependabot-bun-lock.yml`).

Había dos dudas abiertas:

1. ¿Debería Dependabot usar `bun` y no `npm`?
2. ¿Los cinco `package.json` se pueden unificar en uno?

## Opciones Consideradas

### Dependabot

* **A — Solo `npm`** (estado previo). Version updates de manifiestos JS; security updates sí. No escribe `bun.lock`. Exige un workflow `pull_request_target` que ejecuta `bun install` sobre el head de la PR.
* **B — Solo `bun`**. Version updates nativos sobre `bun.lock` (GA desde 2025-02-13; `package-ecosystem: bun`, Bun >= 1.1.39). La tabla oficial de GitHub marca **security updates como no soportadas** para Bun.
* **C — `bun` para versiones + `npm` solo para seguridad** (`open-pull-requests-limit: 0`). Version updates con lockfile nativo; security updates vía npm, que GitHub sí soporta. El workflow de sync queda solo para esos PRs de seguridad.

### Manifiestos

* **D — Unificar todo en un único `package.json` raíz.** Menos archivos, Dependabot más simple. Mezcla React/Vite/Uppy con Hono/tus/Drizzle; hincha la imagen Docker de la API; rompe `bun run --filter '@procomun/*'`; pierde la caché por capa de `COPY apps/*/package.json`.
* **E — Conservar workspaces Bun.** Cada paquete declara lo que importa. La raíz orquesta workspaces y tooling (Biome, Playwright, TypeScript). Duplicar versiones de `pglite`/`drizzle`/`hono` entre consumidores es el contrato de workspaces, no un error.

## Decisión

Se adopta **C + E**.

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "bun"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 0
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
```

Inventario canónico de manifiestos (no reducir):

| Ruta | Paquete | Responsabilidad |
|------|---------|-----------------|
| `package.json` | `procomun` | workspaces, scripts de repo, tooling de CI |
| `apps/api/package.json` | `@procomun/api` | Hono, tus, Better Auth, extracción de texto |
| `apps/cli/package.json` | `@procomun/cli` | comandos de operación e importación |
| `apps/frontend/package.json` | `@procomun/frontend` | React, Vite, Paraglide, Uppy |
| `packages/db/package.json` | `@procomun/db` | Drizzle, esquema, repositorio, seed |

El frontend no declara dependencias de API (`hono`, `@tus/*`, `drizzle-orm`, `better-auth`). La API no declara `react` ni `vite`. Eso se valida en `scripts/check-dependabot-workspaces.ts`.

No se introduce `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` ni el binario legado `bun.lockb`.

## Consecuencias

### Positivas

* Los version updates de Dependabot regeneran `bun.lock` con el gestor real del repo.
* Se conservan security updates (hueco documentado de Bun en GitHub).
* El monorepo sigue pudiendo instalar, filtrar y construir por workspace.
* Un test impide volver a `npm` como gestor de versiones o aplastar los manifiestos.

### Negativas / Riesgos

* Bun aún no tiene security updates nativos. Si GitHub los activa, se puede retirar el bloque `npm` y, si el lockfile llega ya sincronizado, el workflow `dependabot-bun-lock.yml`.
* El workflow de sync sigue usando `pull_request_target` (actor `dependabot[bot]`). No añadir pasos que ejecuten código de la PR.
* Dependabot-core ha tenido incidencias puntuales con `bun.lock` y catálogos Bun. No se adoptan catálogos ahora.

## Notas de Implementación

* Fuentes consultadas el 2026-08-18:
  * [Supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories) — fila Bun: version updates sí, security updates no; lockfile de texto `bun.lock` (>= 1.1.39), no `bun.lockb`.
  * [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) — YAML value `bun`.
  * [Changelog 2025-02-13](https://github.blog/changelog/2025-02-13-dependabot-version-updates-now-support-the-bun-package-manager-ga/) — GA de version updates; security updates «in the future».
  * Context7 `/dependabot/dependabot-core`: `BunPackageManager::LOCKFILE_NAME = "bun.lock"` y `PACKAGE_MANAGER_LOOKUP["bun"]`.
  * Context7 `/websites/bun_sh`: workspaces en `package.json` (`apps/*`, `packages/*`).
* Criterio de revisión: reabrir si GitHub marca security updates de Bun como soportadas, o si el ecosistema `bun` deja de actualizar `bun.lock` en workspaces.

## Criterios de revisión

Reabrir esta ADR si:

* La tabla oficial de ecosistemas marca security updates de Bun como soportadas.
* `package-ecosystem: bun` deja de actualizar `bun.lock` en un monorepo con workspaces.
* Se añade un workspace nuevo: hay que incluirlo en `EXPECTED_WORKSPACE_MANIFESTS` y en el Dockerfile.

# Diseño: Dependabot Bun y workspaces

## Decisión

ADR-0040: `package-ecosystem: bun` para version updates; `npm` con `open-pull-requests-limit: 0` para security updates; workspaces intactos.

## Por qué no solo npm

Consultado el 2026-08-18:

* Context7 `/github/docs` y la [tabla oficial de ecosistemas](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories) listan Bun (`bun`, >= v1.1.39) con version updates.
* Context7 `/dependabot/dependabot-core` define `LOCKFILE_NAME = "bun.lock"` en `BunPackageManager`.
* `npm` no escribe `bun.lock`. Ese hueco es el que rompió CI en los PRs #131 y #300.

## Por qué no solo bun

La misma tabla oficial marca **security updates como no soportadas** para Bun. El changelog de GitHub (2025-02-13) dejó ese hueco explícito. `open-pull-requests-limit: 0` en npm desactiva version updates y deja solo security updates, sin PRs duplicados.

## Por qué no unificar package.json

Es un monorepo Bun, no cinco copias accidentales del mismo manifiesto:

* La raíz declara `workspaces: ["apps/*", "packages/*"]` y el tooling (Biome, Playwright, TypeScript).
* Cada workspace aísla el grafo: el frontend no arrastra Hono/tus; la API no arrastra React/Vite.
* Docker copia manifiestos por workspace para cachear `bun install`.
* `bun run --filter '@procomun/api'` depende de esos nombres.

Unificar sería más simple en Dependabot y más caro en build, imagen y límites de capa. La duplicación de `pglite`/`drizzle` entre consumidores es el contrato de workspaces.

## Validación

`scripts/check-dependabot-workspaces.ts` y su pareja `.unit.test.ts`. El test del repositorio real lee `.github/dependabot.yml` y los manifiestos del disco.

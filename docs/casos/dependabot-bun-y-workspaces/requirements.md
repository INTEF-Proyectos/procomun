# Caso: Dependabot Bun y workspaces del monorepo

## Problema público

Un fallo de Dependabot no es un problema pedagógico, pero sí de operación: PRs de dependencias que rompen CI dejan de aplicarse parches y actualizaciones. El lockfile desincronizado bloquea `bun install --frozen-lockfile` en Docker y en Actions.

## Usuario principal

Equipo de plataforma y quien revise o fusione PRs de Dependabot.

## Requisitos

1. Dependabot debe usar el gestor real del repositorio (Bun) para version updates, de modo que `bun.lock` quede coherente con los `package.json`.
2. No se pueden perder security updates mientras GitHub no las ofrezca para el ecosistema `bun`.
3. Los workspaces (`apps/api`, `apps/cli`, `apps/frontend`, `packages/db`) no se unifican en un solo `package.json`.
4. Un test automatizado impide revertir la política (volver a `npm` como gestor de versiones, o fusionar manifiestos).
5. Sigue habiendo un único lockfile canónico: `bun.lock`.

## Fuera de alcance

* Migrar dependencias entre workspaces ni retirar duplicados de versión (`pglite`, `drizzle-orm`) en la raíz.
* Adoptar catálogos de Bun.
* Cambiar el grafo de dependencias de la aplicación.

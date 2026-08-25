# Validación: Dependabot Bun y workspaces

## Criterios de aceptación

| ID | Criterio | Cómo se comprueba |
|----|----------|-------------------|
| CA-1 | `dependabot.yml` declara `package-ecosystem: bun` en `/` | test «dependabot.yml cumple la política» |
| CA-2 | `npm` existe solo con `open-pull-requests-limit: 0` | el mismo test; fixtures que fallan si el límite falta o es > 0 |
| CA-3 | Siguen `github-actions` y `docker` | `findDependabotPolicyErrors` |
| CA-4 | Existen exactamente los cinco manifiestos esperados | inventario del repo real, sin `node_modules` |
| CA-5 | No hay `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` ni `bun.lockb` | `findForbiddenLockfiles` |
| CA-6 | El frontend no declara deps de API y la API no declara React/Vite | `findCrossLayerDependencyLeaks` |
| CA-7 | Cada workspace es `@procomun/*`, `private` y `type: module` | `findWorkspaceIdentityErrors` |

## Ejecución

```bash
bun test scripts/check-dependabot-workspaces.unit.test.ts
```

Ningún criterio se marca cumplido sin esa salida en verde.

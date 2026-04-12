# Procomun NG

Sustituto moderno de Procomún: una plataforma de recursos educativos abiertos orientada a catalogación, descubrimiento, reutilización, curación, interoperabilidad y publicación.

## Estado actual

El repositorio ya implementa un MVP funcional de catálogo con:

- catálogo público con búsqueda, filtros y detalle de recurso
- backoffice con CRUD unificado para recursos, colecciones, taxonomías, usuarios y ajustes
- flujo editorial con roles `reader`, `author`, `editor`, `curator` y `admin`
- autenticación con Better Auth
- subidas resumables para adjuntos del editor
- integración de eXeLearning y previews de contenido `.elpx`

La fuente de verdad del estado del proyecto es [`status.yaml`](status.yaml) y el seguimiento de producto vive en [`docs/producto/roadmap.md`](docs/producto/roadmap.md).

## Stack actual

- Lenguaje: TypeScript en modo estricto
- Runtime y tooling principal: Bun
- Frontend: React 19 + Vite + React Router
- Backend API: Hono + Better Auth
- Capa de datos: Drizzle ORM
- Base de datos:
  - PostgreSQL en producción
  - PGlite en desarrollo local por defecto
- Tests:
  - `bun test` para unit e integration
  - Playwright para E2E

## Monorepo real

```text
apps/
├── api/         # API HTTP, auth, rutas públicas y admin
├── cli/         # Seed y utilidades de gestión
└── frontend/    # SPA React pública y editorial

packages/
└── db/          # Schema, repositorios, validación, setup y seed

docs/            # Roadmap, arquitectura, ADRs, épicas y casos
e2e/             # Pruebas end-to-end con Playwright
status.yaml      # Tablero global de estado
```

## Desarrollo local

No hace falta PostgreSQL instalado para arrancar el proyecto en local. Por defecto, la API usa PGlite con almacenamiento en disco.

### Requisitos

- Bun
- Docker, solo si quieres usar PostgreSQL real o los flujos dockerizados

### Arranque rápido

```bash
cp .env.example .env
make up
```

`make up` hace lo siguiente:

- instala dependencias
- ejecuta el seed de desarrollo
- comprueba que el editor estático de eXeLearning exista
- arranca API y frontend

Servicios resultantes:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`

### Comandos principales

```bash
make deps
make up
make up-api
make up-frontend
make up-docker
make seed-docker
make down-docker
make up-postgres
make test
make test-unit
make test-integration
make test-e2e
make test-e2e-firefox
make test-e2e-postgres
make lint
make format
```

### Variables importantes

- `DATABASE_URL`: activa PostgreSQL real en lugar de PGlite
- `FRONTEND_URL`: origen confiable del frontend para CORS y sesiones
- `BETTER_AUTH_URL`: base pública usada por Better Auth
- `OIDC_ENABLED`: habilita login institucional cuando vale `true`
- `UPLOAD_STORAGE_DIR`: directorio local para binarios subidos

En desarrollo local normal, `FRONTEND_URL` y `BETTER_AUTH_URL` deben apuntar a `http://localhost:5173`.

## Desarrollo con PostgreSQL real

Si quieres probar la aplicación con PostgreSQL real en Docker:

```bash
make up-postgres
```

Ese target:

- levanta PostgreSQL en Docker
- ejecuta el seed contra PostgreSQL
- arranca API y frontend en local

También puedes separar el flujo:

```bash
make up-docker
make seed-docker
bun run dev:frontend
```

## Testing y calidad

El flujo estándar del repo es:

```bash
make test
```

Ese target ejecuta:

- comprobación de paridad archivo productivo/test
- suite estándar (`unit` + `integration`)
- validación de coverage global

Comandos equivalentes en `package.json`:

```bash
bun run test
bun run test:unit
bun run test:integration
bun run test:e2e
```

## Documentación clave

- [`docs/producto/roadmap.md`](docs/producto/roadmap.md): estado funcional y evolución del producto
- [`docs/producto/arquitectura.md`](docs/producto/arquitectura.md): arquitectura vigente del sistema
- [`docs/producto/modelo-de-dominio.md`](docs/producto/modelo-de-dominio.md): entidades principales
- [`docs/negocio/decisiones/`](docs/negocio/decisiones/): ADRs y decisiones técnicas
- [`docs/epics/`](docs/epics/): requisitos, diseño, tareas y validación por épica

ADRs especialmente relevantes para el estado actual:

- [ADR-0003](docs/negocio/decisiones/0003-framework-http-api.md): Hono para la API
- [ADR-0005](docs/negocio/decisiones/0005-base-de-datos-principal.md): PostgreSQL como base principal
- [ADR-0006](docs/negocio/decisiones/0006-orm-y-capa-acceso-datos.md): Drizzle ORM
- [ADR-0007](docs/negocio/decisiones/0007-autenticacion-y-sesiones.md): Better Auth
- [ADR-0011](docs/negocio/decisiones/0011-subidas-resumibles-tus-disco-local.md): uploads resumables
- [ADR-0017](docs/negocio/decisiones/0017-eliminacion-generacion-web-estatica.md): eliminación del preview estático
- [ADR-0018](docs/negocio/decisiones/0018-migracion-astro-a-react-router.md): migración a React Router + Vite SPA

## Sistema de agentes

El repositorio usa un esquema de trabajo por roles definido en [`AGENTS.md`](AGENTS.md). Los skills especializados viven en `.agents/skills/`.

Ejemplos de uso:

### Diseñar una épica

```text
Quiero iniciar una nueva épica para el sustituto de Procomún.

Usa estos roles:
- @.agents/skills/empresa-y-producto/SKILL.md
- @.agents/skills/direccion-de-plataforma/SKILL.md
- @.agents/skills/evaluacion-tecnologica/SKILL.md
```

### Diseñar una feature

```text
Diseña esta feature: [descripción]

Produce:
- requirements.md
- design.md
- tasks.md

Usa:
- @.agents/skills/arquitectura-solucion/SKILL.md
- @.agents/skills/backend-api-servicios/SKILL.md
- @.agents/skills/qa-validacion/SKILL.md
```

## Convenciones del repositorio

- El código fuente vive en `apps/` y `packages/`
- Toda decisión técnica relevante se registra como ADR
- Toda épica o feature deja trazabilidad en `docs/`
- Todo nuevo archivo `.ts` productivo debe ir acompañado de un test aceptado
- No se considera completada una tarea de código sin test automatizado y ejecución satisfactoria de la validación correspondiente

# Arquitectura del sistema

## Estado

Documento sincronizado con la implementación actual del repositorio.

La arquitectura vigente combina:

- frontend SPA en React 19 + Vite + React Router
- API HTTP en Hono sobre Bun
- autenticación con Better Auth
- acceso a datos compartido en `packages/db` con Drizzle ORM
- PostgreSQL como base principal y PGlite como opción por defecto en desarrollo local

Las decisiones históricas sobre Astro y el preview estático quedaron supersedidas en la implementación por [ADR-0017](../negocio/decisiones/0017-eliminacion-generacion-web-estatica.md) y [ADR-0018](../negocio/decisiones/0018-migracion-astro-a-react-router.md).

---

## Arquitectura del antiguo Procomún y proceso de migración

### Arquitectura actual (legacy)

> Análisis detallado disponible en `docs/casos/contexto-procomun-legacy/estado-del-arte.md`.

El sistema anterior evoluciona desde la red Agrega y agrupa varios subsistemas:

- portal Drupal para catálogo, búsqueda, comunidades y publicación
- repositorio Agrega3 para paquetes SCORM, objetos `.elpx` y metadatos LOM
- banco multimedia integrado
- edición online con eXeLearning
- buscador unificado sobre ODEs y multimedia

### Proceso de migración

La migración al nuevo sistema requiere un proceso ETL:

1. Extraer recursos, usuarios y metadatos del sistema legacy.
2. Transformar y normalizar metadatos, permisos y relaciones.
3. Cargar los datos en el nuevo modelo de dominio y en la nueva base de datos.

---

## Visión general

El sistema se organiza como un monorepo TypeScript con contratos explícitos entre frontend, API, CLI y capa de datos compartida.

```text
┌──────────────────────────────────────────────┐
│                 Navegador                    │
│  catálogo público, backoffice, edición       │
└──────────────────────┬───────────────────────┘
                       │ HTTP + cookies
┌──────────────────────▼───────────────────────┐
│              Frontend SPA                    │
│  React + Vite + React Router                │
│  apps/frontend/                              │
└──────────────────────┬───────────────────────┘
                       │ /api/*
┌──────────────────────▼───────────────────────┐
│                 API HTTP                     │
│  Hono + Bun + Better Auth                    │
│  apps/api/                                   │
└──────────────────────┬───────────────────────┘
                       │ repositorios compartidos
┌──────────────────────▼───────────────────────┐
│              Capa de datos                   │
│  Drizzle ORM + schema + repositorios         │
│  packages/db/                                │
└───────────────┬──────────────────────┬───────┘
                │                      │
      ┌─────────▼─────────┐   ┌────────▼─────────┐
      │   PostgreSQL       │   │   Sistema local  │
      │   producción       │   │   de ficheros    │
      └────────────────────┘   └──────────────────┘

      ┌────────────────────┐
      │ PGlite en local    │
      │ desarrollo por     │
      │ defecto            │
      └────────────────────┘
```

## Monorepo real

```text
procomun/
├── apps/
│   ├── api/          # API pública, admin, auth, uploads, eXeLearning
│   ├── cli/          # seed y utilidades operativas
│   └── frontend/     # aplicación React para catálogo y backoffice
├── packages/
│   └── db/           # schema, repositorios, validación, setup y seed
├── docs/             # roadmap, arquitectura, ADRs, épicas y casos
├── e2e/              # tests Playwright
└── status.yaml       # tablero de estado global
```

## Modos de ejecución

| Modo | Base de datos | Frontend | Auth | Uso |
|------|---------------|----------|------|-----|
| Producción | PostgreSQL | SPA React servida por despliegue real | Better Auth | Entorno real |
| Desarrollo local | PGlite por defecto o PostgreSQL vía `DATABASE_URL` | Vite dev server | Better Auth | `make up`, `make up-postgres` |
| Docker de apoyo | PostgreSQL y API en contenedores | frontend local | Better Auth | `make up-docker`, `make seed-docker` |

No existe ya un modo de preview estático publicado por PR en GitHub Pages.

## Capas y responsabilidades

### Frontend — `apps/frontend/`

- SPA React con `react-router-dom`
- Vite como bundler y dev server
- páginas públicas y editoriales bajo un mismo shell
- i18n integrada en cliente
- llamadas a la API vía cliente HTTP
- componentes React y utilidades para catálogo, perfil, admin, ayuda y edición

Rutas principales implementadas:

- `/`
- `/explorar`
- `/login`
- `/registro`
- `/perfil`
- `/admin/*`
- `/recurso`
- `/colecciones`
- `/editar`
- `/nuevo`
- `/ayuda`

### API — `apps/api/`

- Hono como framework HTTP
- Better Auth para autenticación y sesiones
- rutas públicas bajo `/api/v1/*`
- rutas administrativas bajo `/api/admin/*`
- rutas de auth bajo `/api/auth/*`
- uploads resumables y endpoints ligados al editor eXeLearning

La API compone middleware, rutas y servicios, y delega la persistencia en `packages/db`.

### CLI — `apps/cli/`

- herramienta operativa para seed y gestión de usuarios
- comandos actuales:
  - `seed`
  - `seed:resources`
  - `user:create`
  - `user:list`

### Capa de datos — `packages/db/`

- schema TypeScript con Drizzle
- repositorios compartidos por API y CLI
- validación de reglas de negocio y transiciones editoriales
- setup de tablas y datos de seed

## Persistencia y almacenamiento

### Base de datos

- Producción: PostgreSQL
- Desarrollo local por defecto: PGlite con almacenamiento local
- Desarrollo alternativo: PostgreSQL real configurando `DATABASE_URL`

### Ficheros

- almacenamiento local/volumen para binarios subidos
- configuración vía `UPLOAD_STORAGE_DIR`
- pensado para evolución futura a otro backend de almacenamiento si fuera necesario

## Principios de diseño

1. Contratos explícitos entre capas.
2. Monorepo con código compartido solo donde aporta valor claro.
3. Simplicidad operativa para entorno local: Bun + PGlite por defecto.
4. Separación entre API HTTP, lógica de negocio y persistencia.
5. Accesibilidad, mantenibilidad e interoperabilidad como requisitos base.
6. Trazabilidad documental mediante ADRs, épicas y `status.yaml`.

## ADRs relacionadas

- [ADR-0001](../negocio/decisiones/0001-typescript-bun-como-stack-base.md): TypeScript + Bun como base
- [ADR-0003](../negocio/decisiones/0003-framework-http-api.md): Hono para la API
- [ADR-0004](../negocio/decisiones/0004-framework-frontend.md): decisión inicial de frontend en Fase 0
- [ADR-0005](../negocio/decisiones/0005-base-de-datos-principal.md): PostgreSQL como base principal
- [ADR-0006](../negocio/decisiones/0006-orm-y-capa-acceso-datos.md): Drizzle ORM
- [ADR-0007](../negocio/decisiones/0007-autenticacion-y-sesiones.md): Better Auth
- [ADR-0008](../negocio/decisiones/0008-modelo-de-autorizacion.md): RBAC
- [ADR-0011](../negocio/decisiones/0011-subidas-resumibles-tus-disco-local.md): uploads resumables
- [ADR-0017](../negocio/decisiones/0017-eliminacion-generacion-web-estatica.md): retirada del preview estático y GitHub Pages
- [ADR-0018](../negocio/decisiones/0018-migracion-astro-a-react-router.md): migración a React Router + Vite SPA

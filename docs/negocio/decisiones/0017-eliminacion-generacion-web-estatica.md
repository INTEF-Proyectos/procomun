# ADR-0017 Eliminación de la generación de web estática y preview en GitHub Pages

* Estado: Aceptado
* Fecha: 2026-04-10
* Agentes Implicados: [@.agents/skills/devops-sre, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/backend-api-servicios]

## Contexto y Problema

El proyecto generaba una web estática con Astro desplegada en GitHub Pages con dos propósitos: previews de PRs y demo pública. Esta infraestructura requería:

- Scripts de pre-generación de datos estáticos: `generate-seed-json.ts` y `extract-elpx-for-static.ts`.
- Un `PreviewApiClient` que ejecutaba PGlite WASM en el navegador (~1000 líneas) para simular la API en modo estático.
- Workflows de CI/CD dedicados: `deploy.yml` (despliegue a GitHub Pages) y `preview.yml` (previews por PR).
- Lógica condicional `PREVIEW_MODE` / `PREVIEW_STATIC` / `PREVIEW_BASE` dispersa por todo el frontend (layouts, páginas, islands, uploaders).
- Targets `build-preview` y `up-static` en el Makefile.

El desarrollo ha evolucionado hacia un enfoque local-based: con PGlite en la API local y Bun se puede probar todo rápidamente sin necesidad de preview URLs. Esta infraestructura de preview añadía complejidad significativa sin aportar valor proporcional en el estado actual del proyecto.

## Opciones Consideradas

* **A) Mantener como está**: conservar la generación estática y los workflows de preview en GitHub Pages. Implica mantener dos paths de ejecución paralelos (preview vs normal) con complejidad creciente.
* **B) Eliminar generación estática, mantener Astro**: eliminar todo el código preview-specific (~1500 líneas) pero conservar Astro como framework de frontend con su routing por ficheros, i18n con Paraglide e islands architecture.
* **C) Eliminar estático y migrar de Astro a React puro (Vite + React Router)**: eliminar Astro además de la infraestructura estática y reescribir el frontend con React puro. Los 67 archivos `.tsx` de islands están totalmente desacoplados de Astro (0 imports de `astro` en código React), lo que facilitaría la migración, pero no justifica el esfuerzo actual.

## Decisión

Se elige la **opción B**: eliminar la generación estática y la infraestructura de preview, manteniendo Astro como framework de frontend.

**Qué se elimina (~1500 líneas de código preview-specific):**
- Workflows: `deploy.yml` y `preview.yml`
- Scripts: `generate-seed-json.ts` y `extract-elpx-for-static.ts`
- `PreviewApiClient` (PGlite en browser para modo estático)
- `PreviewBannerIsland` y `PreviewBanner` components
- `preview-file-store.ts` y `elpx-preview-service.ts`
- Toda la lógica condicional `PREVIEW_MODE` / `PREVIEW_STATIC` / `PREVIEW_BASE` en layouts, páginas e islands
- Targets `build-preview` y `up-static` del Makefile
- Script `build:preview` del package.json del frontend

**Qué se mantiene:**
- PGlite en API local y CLI para desarrollo sin PostgreSQL externo
- Astro como framework de frontend con `output: static`
- React islands sin cambios
- `HttpApiClient` como único cliente de API
- Proxy de Vite a localhost:3000 (ahora siempre activo)

## Consecuencias

### Positivas
* Simplificación del pipeline de CI/CD: se eliminan dos workflows de GitHub Actions y la rama `gh-pages`
* Build config más simple: un único path de ejecución sin condicionales de modo preview
* Reducción de ~1500 líneas de código de mantenimiento complejo
* Código frontend más legible sin lógica condicional de modo preview dispersa por layouts, páginas e islands
* La migración futura de Astro a React puro queda facilitada por el desacoplamiento ya existente entre Astro y los islands React

### Negativas / Riesgos
* Los revisores de PRs deben levantar el entorno local para probar cambios de frontend (aceptable dado que `make up` con PGlite es rápido)
* Se pierde la demo pública sin necesidad de levantar nada (se recuperará cuando se despliegue la plataforma real en producción)

## Notas de Implementación

La eliminación afecta a los siguientes componentes del repositorio:

1. **`.github/workflows/`**: eliminados `deploy.yml` y `preview.yml`
2. **`packages/db/src/`**: eliminados `generate-seed-json.ts` y `extract-elpx-for-static.ts`
3. **`apps/frontend/src/lib/`**: eliminados `preview-api-client.ts`, `elpx-preview-service.ts`, `preview-file-store.ts`; simplificados `get-api-client.ts`, `paths.ts`, `resource-uploader.ts`
4. **`apps/frontend/src/layouts/`**: limpiados `Base.astro` y `PublicLayout.astro` de referencias a `PreviewBanner` y `PUBLIC_PREVIEW_MODE`
5. **`apps/frontend/src/pages/`**: limpiadas todas las páginas de edición y creación de recursos (versiones con y sin locale, y admin)
6. **`apps/frontend/astro.config.ts`**: eliminadas variables `PREVIEW_STATIC`/`PREVIEW_BASE`, fijados `site` y `base`, proxy de Vite siempre activo
7. **`Makefile`**: eliminados targets `build-preview` y `up-static`

Si en el futuro se decide migrar de Astro a React puro, el desacoplamiento existente (0 imports de `astro` en archivos `.tsx`) lo facilita sin necesidad de reescritura masiva.

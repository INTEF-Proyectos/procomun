# ADR-0018 Migración de Astro a React Router + Vite SPA

* Estado: Aceptado
* Fecha: 2026-04-10
* Agentes Implicados: [@.agents/skills/frontend-ux-accesibilidad, @.agents/skills/arquitectura-solucion]

## Contexto y Problema

Tras eliminar la generación estática (ADR-0017), se evaluó si Astro seguía aportando valor al proyecto. El análisis reveló:

- **0 datos pre-renderizados**: todas las páginas cargan datos en cliente via React islands con `client:load`. Astro genera shells HTML vacíos.
- **0 content collections**: no se usa ninguna feature avanzada de Astro.
- **67 componentes React**: toda la lógica de negocio, estado y UI vive en React islands completamente desacoplados de Astro (0 imports de `astro` en archivos `.tsx`).
- **Solo `getStaticPaths` para i18n**: la única feature de Astro usada era generar rutas por locale, replicable con un parámetro de React Router.
- **6 páginas con scripts inline**: editar.astro y nuevo.astro tenían ~600 líneas de scripts vanilla JS con manipulación DOM directa, sin acceso al tooling de React (hot-reload, testing, hooks).
- **Paraglide es un plugin de Vite**: la i18n funciona independientemente de Astro.
- **Dos lenguajes de componentes**: mantener `.astro` (layouts, pages) + `.tsx` (islands) añadía complejidad sin beneficio.

## Opciones Consideradas

* **A) Mantener Astro**: conservar el framework aunque aporte poco valor. Implica mantener dos lenguajes y scripts inline sin tooling React.
* **B) Migrar a React Router + Vite SPA**: eliminar Astro, unificar todo en React con Vite como bundler y React Router para routing.
* **C) Migrar a Next.js / Remix**: frameworks React con SSR. Añaden complejidad de servidor innecesaria para una SPA.
* **D) Migrar a TanStack Router**: router type-safe con file-based routing. Menor ecosistema que React Router.

## Decisión

Se elige la **opción B**: migrar a React Router + Vite SPA.

**Justificación:**
- React Router es el estándar de facto con el mayor ecosistema.
- Vite ya era el bundler subyacente de Astro, la transición es directa.
- No se necesita SSR: las páginas son SPAs que cargan datos en cliente.
- Paraglide sigue funcionando como plugin de Vite sin cambios.
- Los scripts inline se convierten a componentes React con hooks, ganando testing, HMR y ciclo de vida.

## Qué cambia

**Eliminado:**
- `astro`, `@astrojs/react`, `@astrojs/check` como dependencias
- `astro.config.ts` (reemplazado por `vite.config.ts`)
- Todos los archivos `.astro` (26 páginas + 2 layouts)
- `getStaticPaths` para routing i18n
- Scripts inline en páginas (migrados a React)
- tsconfig que extendía `astro/tsconfigs/strict`

**Añadido:**
- `react-router-dom` para routing SPA
- `@vitejs/plugin-react` (antes envuelto por `@astrojs/react`)
- `vite.config.ts` con Paraglide, proxy y optimizeDeps
- `index.html` como entry point SPA
- `src/main.tsx` con BrowserRouter
- `src/App.tsx` con rutas (locale opcional via `:locale?`)
- `src/layouts/PublicLayout.tsx` (convertido de `.astro`)
- Páginas React en `src/pages/*.tsx` (una por ruta)
- CSS extraído de `.astro` a archivos separados en `src/styles/`

**Sin cambios:**
- 67 React islands en `src/islands/` (sin modificaciones)
- Paraglide i18n (mismo plugin de Vite)
- PGlite para desarrollo local
- API client, paths.ts, utilidades
- Proxy de Vite a localhost:3000

## Consecuencias

### Positivas
* Un solo lenguaje de componentes: React para todo (páginas, layouts, islands)
* Hot-reload completo: todos los componentes tienen HMR, incluyendo los que eran scripts inline
* Testing unificado: las páginas son componentes React testeables con las mismas herramientas
* Build más rápido: Vite SPA build (~1.3s) vs Astro static build (~2.3s)
* Lazy loading nativo: React.lazy + Suspense para code splitting por ruta
* Menor complejidad: no hay distinción islands/pages/layouts — todo es React

### Negativas / Riesgos
* Sin pre-renderizado HTML: el first paint requiere cargar JS. Aceptable dado que no había contenido real pre-renderizado.
* Routing SPA requiere configuración del servidor para redirigir rutas a index.html (historyApiFallback). El proxy de Vite lo maneja en desarrollo; en producción se configurará en el servidor.
* Si en el futuro se necesita SSR para SEO, se requerirá migrar a un framework React con SSR (Remix, Next.js, o React Router con SSR mode).

## Notas de Implementación

El routing i18n usa un parámetro opcional de React Router:
- `/explorar` → locale "es" (default, sin prefijo)
- `/en/explorar` → locale "en"

El componente `LocaleSync` en App.tsx actualiza `document.documentElement.lang` cuando cambia la ruta, lo que permite a `getCurrentLocale()` de paths.ts y a Paraglide detectar el idioma correctamente.

Los scripts inline de editar.astro y nuevo.astro se convirtieron a componentes React con `useEffect` + `useRef` para mantener toda la funcionalidad existente (formularios, upload de archivos, integración eXeLearning).

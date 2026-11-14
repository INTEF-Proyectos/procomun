# E2E Tests — Procomún

Suite de tests end-to-end con [Playwright](https://playwright.dev/) para la plataforma Procomún.

## Requisitos previos

- **Bun** (v1.x+)
- **Node.js** (para Playwright browsers)
- Base de datos con seed ejecutado

## Configuración rápida

```bash
# Instalar dependencias del proyecto
bun install

# Instalar navegadores Playwright
bunx playwright install --with-deps

# Ejecutar el seed para tener datos de prueba
bun run --filter '@procomun/cli' cli -- seed

# Arrancar la aplicación (API + Frontend)
bun run dev
```

## Ejecución de tests

```bash
# Tests E2E con Chromium (por defecto)
bun run test:e2e

# Tests con interfaz visual de Playwright
bun run test:e2e:ui

# Tests en modo headed (ver el navegador)
bun run test:e2e:headed

# Tests con Firefox
bun run test:e2e:firefox

# Tests con WebKit
bun run test:e2e:webkit

# Todos los navegadores
bun run test:e2e:all

# Ver último reporte HTML
bun run test:e2e:report
```

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `E2E_BASE_URL` | URL base de la aplicación | `http://localhost:5173` |
| `CI` | Activa retries y reporter CI | - |

## Estructura de carpetas

```
e2e/
├── tests/
│   ├── public/          # Flujos sin autenticación
│   │   ├── home-and-search.e2e.ts
│   │   ├── filters.e2e.ts
│   │   ├── resource-detail.e2e.ts
│   │   ├── collections.e2e.ts
│   │   ├── navigation.e2e.ts
│   │   ├── i18n.e2e.ts
│   │   └── responsive.e2e.ts
│   ├── auth/            # Login, logout, registro
│   │   └── login-logout.e2e.ts
│   ├── author/          # Flujos de autor
│   │   └── backoffice.e2e.ts
│   ├── curator/         # Flujos de curador
│   │   └── review.e2e.ts
│   ├── admin/           # Flujos de admin
│   │   └── admin-panel.e2e.ts
│   └── accessibility/   # Tests WCAG AA
│       └── wcag.e2e.ts
├── fixtures/            # Datos de prueba
│   ├── test-users.ts
│   └── test-data.ts
├── pages/               # Page Objects (cuando aporten valor)
├── utils/               # Helpers
│   └── auth.ts
└── README.md
```

## Datos de prueba (seed)

Los tests dependen del seed ejecutado por `apps/cli/src/commands/seed.ts`. El seed crea:

- **Usuarios**: admin, curator, editor, author, reader (password: `password`)
- **Recursos**: 22 recursos con diferentes estados (published, draft)
- **Colecciones**: 8 colecciones públicas
- **Ratings, favoritos, descargas**: Datos sociales de prueba

Los tests NO crean datos externos ni dependen de servicios remotos.

## Convenciones

### Selectores (prioridad)

1. `getByRole()` — semántico y accesible
2. `getByLabel()` — para formularios
3. `getByText()` — para contenido estable
4. `data-testid` — solo si no hay alternativa accesible

### Estabilidad

- ❌ No usar `waitForTimeout()` (sleeps fijos)
- ❌ No depender de clases CSS frágiles
- ❌ No depender de orden no garantizado
- ✅ Usar auto-wait de Playwright
- ✅ Usar fixtures aisladas
- ✅ Usar `test.fixme()` para tests pendientes de implementación UI

### Añadir nuevos tests

1. Crear archivo `*.e2e.ts` en la subcarpeta adecuada
2. Usar datos del seed (ver `e2e/fixtures/test-data.ts`)
3. Para tests autenticados, usar `loginAs()` de `e2e/utils/auth.ts`
4. Para funcionalidad no implementada, usar `test.fixme()`

## Debugging

### Ver traces de fallos

```bash
# Abrir trace viewer
bunx playwright show-trace test-results/<test-folder>/trace.zip
```

### Generar reporte HTML

```bash
bun run test:e2e:report
```

### Ejecutar un test específico

```bash
bunx --bun playwright test --grep "login"
bunx --bun playwright test tests/public/home-and-search.e2e.ts
```

## Capturas visuales en pull requests

Después de superar la suite E2E de Chromium, CI genera capturas de escritorio de
las vistas definidas en `e2e/visual-preview-pages.ts`. Un workflow separado y
confiable publica las imágenes y actualiza un único comentario en el pull
request.

Para añadir una vista, incorpora una entrada a `VISUAL_PREVIEW_PAGES`:

- `id`: nombre de fichero estable, en minúsculas, con números o guiones y un
  máximo de 64 caracteres.
- `title`: nombre descriptivo usado por Playwright.
- `path`: URL relativa; puede contener query string.
- `readySelector`: selector CSS que confirma que el contenido asíncrono ya está
  listo para la captura.
- `auth`: rol opcional de `TEST_USERS`; si se indica, Playwright inicia sesión
  antes de abrir la URL.

El conjunto admite hasta 20 PNG, de 10 MiB como máximo cada uno. Los workflows no
necesitan cambios al añadir otra entrada.

Ejecución local, con la aplicación y el seed ya iniciados:

```bash
CAPTURE_VISUAL_PREVIEWS=true \
VISUAL_PREVIEW_DIR=visual-previews \
bunx --bun playwright test e2e/visual-preview.e2e.ts --project=chromium --workers=1
```

## CI/CD

Los E2E se ejecutan en GitHub Actions (`.github/workflows/e2e.yml`):

- **En cada PR**: Solo Chromium (rápido)
- **Manual/Nocturno**: Firefox + WebKit (cross-browser completo)
- **Artifacts**: Report HTML y traces se suben en caso de fallo

## Rendimiento (pendiente)

Para tests de rendimiento/carga, se recomienda evaluar:

- **Lighthouse CI**: Para medir Core Web Vitals en páginas clave
  ```bash
  npx lhci autorun --collect.url=http://localhost:5173
  ```
- **k6**: Para tests de carga/stress sobre la API
  ```bash
  k6 run scripts/load-test.js
  ```
- **Artillery**: Alternativa a k6 con sintaxis YAML

El pliego original CE01698/2023 exige JMeter para carga, pero k6/Artillery son alternativas modernas compatibles con el stack TypeScript + CI de GitHub Actions.

## Limitaciones conocidas

- Algunos tests de curator/admin están marcados como `test.fixme()` porque la UI de backoffice está en desarrollo.
- La creación de recursos (`/nuevo`) parte de la subida de un paquete `.elpx` (eXeLearning), no de un formulario de título/descripción, por lo que el test de alta de recurso está marcado como `test.fixme()` hasta disponer de una fixture `.elpx` o un formulario de metadatos.
- El upload TUS no se testea E2E aún (pendiente de integración completa).
- La recuperación de contraseña no está disponible en la UI actual.
- Los tests de accesibilidad usan `@axe-core/playwright`, ya incluido como `devDependency` del proyecto (se instala con `bun install`).

# ADR-0046 Miniaturas generadas en el servidor para los paquetes sin imagen

* Estado: Aceptado
* Fecha: 2026-10-27
* Fecha de decisión: 2026-11-03
* Agentes Implicados: [@.agents/skills/evaluacion-tecnologica, @.agents/skills/direccion-de-plataforma, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/devops-sre, @.agents/skills/backend-api-servicios, @.agents/skills/frontend-ux-accesibilidad]

## Contexto y Problema

Issue #470, que sale de #409.

Con #409 la tarjeta de un recurso usa, por este orden: `screenshot.png` de eXeLearning 4 (#471, columna `elpx_projects.has_screenshot`), la imagen `preview` del Procomún antiguo copiada a `storageDir/thumbnails/<sha256>.<ext>` y servida en `/api/v1/thumbnails/` (#472), el iframe del `.elpx` como reserva y, al final, el marcador del tipo de recurso.

El iframe de reserva existe para no deshacer #426, pero cada tarjeta con iframe descarga y ejecuta el paquete entero. En Explorar cada una deja un `Failed to initialize Teacher Mode` en la consola, y si el paquete falla se ve su error. Siguen sin imagen propia los paquetes de eXe 3, los de eXe 4 anteriores a la 4.0.1 y los recursos importados sin `preview`. El fondo legacy son unos 78.800 recursos (ADR-0029); es la cota superior del relleno.

La propuesta de la issue es capturar la portada (`index.html`) del paquete en un navegador sin interfaz y guardar la imagen como miniatura. Así los listados dejan de necesitar el iframe.

Lo que hay hoy en el código y condiciona la decisión:

* **Extracción.** `processElpxUpload` (`apps/api/src/services/elpx-processor.ts`) extrae con `safeExtractElpx` (ADR-0026) en `storageDir/elpx/<hash>/` y devuelve `hasPreview` si hay `index.html`. Lo llaman las subidas (`routes/uploads.ts`), el editor y la administración (`routes/admin/elpx.ts`, tres sitios), la importación legacy (`apps/cli/src/commands/import-legacy-procomun.ts`) y los seeds.
* **Servicio del contenido.** `routes/elpx-content.ts` sirve el paquete en `/api/v1/elpx/<hash>/…` sin sesión (el hash es la credencial) y con `ELPX_HTML_CSP`, que lleva `sandbox allow-scripts …` sin `allow-same-origin`: el JavaScript del autor corre en origen opaco.
* **Miniaturas.** `services/legacy-preview-image.ts` ya define el almacén (`thumbnails/<sha256>.(png|jpg|gif|webp)`), la detección del tipo por los primeros bytes y la ruta inmutable `/api/v1/thumbnails/:file`.
* **Trabajos en segundo plano.** No hay cola ni broker. La extracción de texto para FTS (`apps/api/src/fts/worker.ts`) es un «dispara y olvida» dentro del proceso de la API, con el estado en columnas de la base de datos (`pending`/`processing`/`completed`/`error`) y reindexado manual desde administración.
* **Despliegue.** `Dockerfile` con base `oven/bun:latest`, etapas `api`, `seed`, `frontend` (nginx) y `app` (todo en uno), y `docker-compose.yml` con `db` + `app` (ADR-0015). Ninguna imagen trae navegador. Playwright 1.64.1 ya está en `devDependencies` para los e2e; `chromium-headless-shell` ocupa unos 200 MB y Chromium completo unos 360 MB, sin contar las bibliotecas del sistema.

## Opciones Consideradas

Hay dos preguntas separables: **qué motor genera la imagen** y **cómo se encolan los trabajos**.

### A. Motor

* **A1 — No generar; quitar el iframe y dejar el marcador por tipo.** Coste cero, pero deshace #426: miles de recursos vuelven a verse con un icono. Descartada como solución, aunque es el comportamiento de reserva cuando la captura falla.
* **A2 — Miniatura sintética sin navegador.** Componer la imagen con el título, la primera imagen del contenido (`content.xml`) y los colores del tema, con una biblioteca de imagen (`sharp` o `@resvg/resvg-js`). No ejecuta nada del autor y es rápida, pero no es la portada real, depende de que el paquete tenga una imagen aprovechable y añade un diseño más que mantener. Útil como segunda reserva, no como solución principal.
* **A3 — Playwright dentro del proceso de la API.** Lo más sencillo de montar: `processElpxUpload` encola y el mismo proceso captura. Pero mete un navegador (cientos de MB y memoria por pestaña) en el contenedor que tiene la sesión, los secretos de `better-auth` y la conexión a la base de datos, y un cuelgue o un pico de memoria del navegador afecta a la API. Descartada por aislamiento.
* **A4 — Servicio propio `thumbnailer` con Playwright, en un contenedor aparte (recomendada).** Un servicio HTTP interno y sin estado: recibe el hash, abre el paquete desde el volumen de almacenamiento montado en solo lectura y devuelve la imagen. El paquete se sirve con `page.route()` sobre un origen ficticio (`https://elpx-thumb.invalid/`): cada petición se resuelve desde disco y cualquier otra URL se aborta, así que el contenido no tiene red. La respuesta HTML lleva la misma `ELPX_HTML_CSP` (origen opaco). Sin credenciales ni base de datos.
* **A5 — Gotenberg como servicio aparte (solución de mercado).** API HTTP mantenida y muy usada, con Chromium dentro; desde la 8 tiene `POST /forms/chromium/screenshot/url` (y `/html`) con `width`, `height`, `clip`, `format` (png, jpeg, webp), `waitForSelector`/`waitDelay`, cola (`--chromium-max-queue-size`), concurrencia, reinicio de Chromium cada N conversiones y listas de URLs permitidas y denegadas (`--chromium-allow-list`, `--chromium-deny-list`, `--chromium-deny-private-ips`). Inconvenientes: la ruta `/html` aplana los ficheros en un solo directorio y los `.elpx` usan subcarpetas (`content/`, `libs/`, `theme/`), así que habría que usar `/url` contra `http://app:3000/api/v1/elpx/<hash>/index.html`, con la red interna abierta del navegador a la API; la imagen oficial incluye LibreOffice y pesa bastante más que A4 (hay que medirla), y el control fino (esperar a que eXe pinte, recortar la navegación, detectar portada vacía) se hace con menos herramientas que en Playwright.
* **A6 — Servicio externo de capturas (SaaS: Microlink, ScreenshotOne, Urlbox…).** Sin infraestructura propia, pero exige que el paquete sea accesible desde Internet, cobra por captura (el relleno son decenas de miles), saca contenido de la Administración fuera de nuestra infraestructura (ENS, ADR-0015) y crea dependencia de un proveedor. Descartada.
* **A7 — Capturar en el navegador del autor al subir (p. ej. `html2canvas`).** No sirve para el relleno ni para la importación legacy, y no puede leer un iframe de origen opaco. Descartada.

### B. Cola y momento

* **B1 — Estado en la base de datos y bucle en la API (recomendada).** Mismo patrón que FTS, pero con un bucle que recoge pendientes en vez de «dispara y olvida»: columnas en `elpx_projects` y un bucle que toma lotes con `SELECT … FOR UPDATE SKIP LOCKED`, llama al motor y guarda el resultado. Sobrevive a reinicios, no necesita broker y el relleno solo marca filas como pendientes.
* **B2 — `pg-boss` (cola sobre PostgreSQL).** Reintentos, programación y concurrencia hechos. Añade una dependencia y su esquema propio para un único tipo de trabajo. Razonable si aparecen más trabajos en segundo plano.
* **B3 — Redis + BullMQ.** Un servicio más en el despliegue solo para esto. Descartada.
* **B4 — Síncrono al subir.** La subida esperaría segundos a un navegador y fallaría si el servicio no está. Descartada.

## Decisión

**A4 + B1**, con A1 como reserva cuando la captura falla. Aceptada el 2026-11-03, con los cambios de la sección «Decisiones del 2026-11-03» al final, que prevalecen sobre los puntos 5 a 7.

1. **Servicio `thumbnailer`.** Nueva app `apps/thumbnailer/` (TypeScript, Playwright, `chromium-headless-shell`) y nueva etapa `thumbnailer` en el `Dockerfile`. Expone `POST /render {hash}` en la red interna y devuelve la imagen o un motivo (`empty`, `timeout`, `error`). Mantiene un navegador vivo, abre un contexto nuevo por paquete y reinicia el navegador cada N capturas o si supera la memoria.
2. **Aislamiento del contenido.** Origen ficticio con `page.route()`: se sirve solo lo que está dentro de `storageDir/elpx/<hash>/` (con la misma comprobación de contención que `elpx-content.ts`) y se aborta todo lo demás, incluidas las URLs externas. Respuestas HTML con `ELPX_HTML_CSP` (origen opaco), contexto sin cookies ni almacenamiento previo, `serviceWorkers: "block"`, sin descargas, diálogos cerrados automáticamente y tiempo máximo por paquete (propuesta: 15 s en total).
3. **Contenedor.** Usuario sin privilegios y el sandbox de Chromium activo (sin `--no-sandbox`), sistema de ficheros raíz de solo lectura, el almacenamiento montado en solo lectura, límites de memoria, CPU y procesos, sin variables de entorno con secretos y en una red de Docker interna sin salida a Internet, alcanzable solo desde `app`.
4. **Cola en la API (B1).** Columnas nuevas en `elpx_projects`: `thumbnail_status` (`pending`, `processing`, `done`, `empty`, `failed`, `skipped`), `thumbnail_file` (nombre en `thumbnails/`), `thumbnail_attempts` y `thumbnail_error`. Van en `elpx_projects` y no en `resources`, igual que `has_screenshot` (#471): las versiones apuntan al proyecto, así que restaurar una versión conserva su miniatura. `processElpxUpload` deja `pending` si no hay `screenshot.png` y hay `index.html` (si no, `skipped`). Un bucle en la API, activo solo si está definida `THUMBNAILER_URL`, procesa lotes pequeños con concurrencia configurable y reintenta hasta 3 veces los fallos pasajeros.
5. **Almacén y API.** La imagen se guarda en `storageDir/thumbnails/<sha256>.<ext>` y se sirve por la ruta de #472. `elpxPreview` añade la URL generada, y la tarjeta usa: `screenshot.png` > `preview` legacy > miniatura generada > marcador por tipo. **El iframe sale de los listados** cuando el relleno haya terminado (último criterio de #409).
6. **Relleno.** Comando `elpx:thumbnails [--dry-run] [--limit N] [--force]` que marca como `pending` los proyectos sin miniatura; el bucle hace el resto. Informe con totales por estado.
7. **Captura.** Ventana de 1280×800 con `deviceScaleFactor: 0.5`, así que Chromium entrega directamente 640×400 sin redimensionar después. JPEG de calidad 80, que Playwright produce de serie; WebP exige pasar por CDP (`Page.captureScreenshot`) y se deja como mejora. Se espera a `load`, a `document.fonts.ready` y a un margen corto. Si la portada no tiene texto ni imágenes visibles se marca `empty` y no se guarda nada.

Si se prefiere no mantener código de navegador, **A5 (Gotenberg)** cabe detrás de la misma interfaz: el bucle de la API llama a un «renderizador» y hay dos adaptadores posibles. Lo que cambia es que el navegador necesita red hacia la API y que la imagen de Docker es más grande.

## Consecuencias

### Positivas
* Los listados dejan de cargar iframes: menos peso, menos CPU en el cliente y sin errores de paquetes ajenos en la consola.
* El contenido del autor nunca corre con el origen de la plataforma ni con acceso a red, sesión o secretos: hay tres capas (origen opaco, sandbox de Chromium y contenedor sin red ni credenciales).
* La API no carga con el navegador: si `thumbnailer` cae, las subidas siguen y los pendientes esperan.
* Reutiliza el almacén, la ruta y la detección de tipo de #472, y el patrón de estado de FTS. Sin broker nuevo.
* Despliegue opcional: sin `THUMBNAILER_URL`, todo sigue igual que ahora con el marcador por tipo.

### Negativas / Riesgos
* **Seguridad.** Chromium es superficie de ataque: un fallo del motor de renderizado más un escape del sandbox daría ejecución en el contenedor. Mitigación: sandbox activo, usuario sin privilegios, sin red ni secretos, solo lectura, y actualizar Playwright con Dependabot (ADR-0040). Hay que revisar la imagen con cada versión de Chromium.
* **Agotamiento de recursos.** Bucles infinitos, bombas de memoria o miles de nodos: tiempo máximo por paquete, cierre del contexto, límites de memoria y procesos del contenedor y reinicio periódico del navegador.
* **Rendimiento y coste.** Entre 1 y 3 s por paquete según el peso (hay que medirlo en un piloto). Para las 78.800 filas del fondo: unas 22–66 h con una captura a la vez, o unas 6–17 h con cuatro. La imagen `thumbnailer` añade del orden de 400–500 MB y cada pestaña viva cientos de MB de RAM. Disco: unos 20–50 KB por miniatura a 640×400, entre 1,5 y 4 GB para el fondo completo, siempre por debajo de lo que ya ocupan los paquetes extraídos.
* **Calidad de la captura.** Los vídeos y embeds externos salen vacíos porque no hay red; algunos paquetes pintan la portada con retraso o abren con la navegación de eXe a la vista. Hace falta un piloto con paquetes reales de eXe 2, 3 y 4.
* **Bun y Playwright.** Hay que comprobar que Playwright lanza Chromium bajo Bun en la imagen. Si no, `thumbnailer` usaría Node, como excepción acotada a ese servicio (ADR-0001).
* **Operación.** Un servicio más en `docker-compose.yml` y en la documentación de `docs/operaciones/`; la imagen todo en uno (`app`) no lo incluye.
* **Lock-in.** Bajo: Playwright y Chromium son abiertos y el motor está detrás de una interfaz que admite Gotenberg.

## Notas de Implementación

* No se implementa nada hasta que el usuario cierre las preguntas abiertas de la issue #470. Diseño y tareas: `docs/epics/epic-003/features/feature-miniaturas-servidor/`.
* Depende de #471 (`has_screenshot`, migración `0015`) y #472 (almacén de miniaturas). La migración nueva tomará el siguiente número libre en `main` al implementarla.
* Validación (regla 14): tests unitarios del bucle y del estado en PGlite, del interceptor de rutas (contención, abortar URLs externas, CSP) y de la detección de portada vacía. Un test de integración que lance Chromium con un paquete sintético que intente `fetch` a una URL externa y a `document.cookie`, y compruebe que no sale nada. El e2e de los listados debe comprobar que no queda ningún `<iframe>` en las tarjetas.
* Relación con otras ADR: aplica a la captura el origen opaco de ADR-0026. Si se adopta la opción 3 de ADR-0027 (origen separado sin cookies), el interceptor podrá cargar el paquete desde ese origen en vez de servirlo desde disco.

## Decisiones del 2026-11-03

Respuestas de @juanda a las preguntas abiertas de la issue #470. Prevalecen sobre lo que se proponía arriba.

1. **Motor:** A4, servicio propio con Playwright.
2. **Despliegue:** contenedor propio para el `thumbnailer`. El límite de RAM se ajusta a lo que necesite.
3. **Cola:** B1, con el estado en `elpx_projects` y un bucle en la API. Si más adelante aparecen otros trabajos en segundo plano, se puede revisar `pg-boss` (B2).
4. **Captura:** JPEG de 640×400 y solo el contenido. La captura oculta la navegación de eXe (menú, cabecera y paginación) y deja la portada del contenido.
5. **Relleno:** solo los proyectos que no tienen imagen propia: ni `screenshot.png` ni `preview` legacy. Cambia el punto 6, que marcaba todos los que no tenían miniatura.
6. **Iframe:** sale de los listados en cuanto se despliegue, sin esperar al relleno. Mientras un recurso no tenga miniatura, se ve el marcador de su tipo. Cambia el punto 5.
7. **Bun o Node:** si Playwright no funciona bien bajo Bun en la imagen, el `thumbnailer` usa Node, como excepción acotada a ese servicio (ADR-0001).

Con esto queda resuelta la condición de las Notas de Implementación: ya se puede implementar.

# ADR-0033 Publicación segura de capturas visuales de pull requests mediante `workflow_run`

* Estado: **Aceptado**
* Fecha: 2026-07-17
* Agentes Implicados: @.agents/skills/devops-sre, @.agents/skills/qa-validacion, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/arquitectura-solucion
* Trazabilidad: issue #283, PR #284

## Contexto y Problema

El workflow E2E de Procomún levanta la API y el frontend con datos de seed y ejecuta Playwright sobre cada pull request, pero el resultado visual no queda disponible en la conversación del PR. La revisión de cambios de interfaz exige arrancar la rama localmente y dificulta detectar regresiones de composición, estilos o contenido.

Se requiere capturar, después de que pasen los E2E de Chromium, un conjunto ampliable de vistas de escritorio: home, login, detalle de un recurso publicado, resultados de búsqueda y dashboard autenticado como administrador. Un nuevo push debe sustituir las capturas anteriores y actualizar un único comentario con el commit y la hora del run.

La solución cruza una frontera de confianza de GitHub Actions:

* El workflow `pull_request` ejecuta código controlado por la rama propuesta. Debe conservar `contents: read` y no recibir secretos ni permisos para comentar o publicar.
* El comentario necesita URLs estables que GitHub pueda renderizar como imágenes. Los artifacts de Actions son temporales y su URL de descarga no es una URL directa adecuada para incrustar cada PNG.
* Un workflow disparado mediante `workflow_run` puede recibir permisos de escritura aunque el workflow anterior no los tuviera. GitHub advierte que procesar datos o artifacts no confiables desde ese workflow puede introducir compromisos del repositorio.
* Las capturas autenticadas deben usar exclusivamente usuarios y contenido del seed de E2E; no deben contener datos personales ni secretos reales.
* El primer `workflow_run` no puede validarse en el mismo PR que lo crea, porque el archivo debe existir previamente en la rama por defecto.

## Opciones Consideradas

* **Auto PR Screenshots**: acción específica con configuración de múltiples URLs, pasos de interacción, rama de almacenamiento y comentario actualizable. Su configuración documentada concede `contents: write` y `pull-requests: write` al mismo job que hace checkout y ejecuta código del PR. Se descarta por mezclar los dominios de confianza, por el comportamiento limitado con forks y porque su versión vigente sigue marcada como beta.
* **Argos, Webshot Archive u otro servicio alojado**: aportan almacenamiento, comparación contra baseline, diffs y una interfaz de aprobación. Se descartan por ahora porque requieren cuenta, aplicación de GitHub, credenciales y tratamiento de las imágenes por un tercero. Argos queda como alternativa si el proyecto aprueba ese servicio y necesita regresión visual, no solo evidencia visual.
* **Lost Pixel OSS**: ofrece comparación visual y custom screenshots. Se descarta porque el producto está en retirada y el repositorio fue archivado en abril de 2026.
* **Solo artifacts de GitHub Actions**: mantiene el token de la PR en solo lectura y no añade almacenamiento persistente. Se descarta como solución completa porque no permite incrustar de forma fiable cada imagen en el comentario y los artifacts caducan.
* **Publicar desde el propio workflow de PR en una rama o release**: simplifica el pipeline, pero entrega permisos de escritura al job que ejecuta código no confiable. Se descarta.
* **Captura no privilegiada + publicación confiable mediante `workflow_run`**: el E2E genera PNG y un artifact temporal; un segundo workflow, cargado desde la rama por defecto, valida los archivos, los publica como assets y actualiza el comentario. Es la opción elegida.

## Decisión

Separar la captura y la publicación en dos workflows con privilegios mínimos.

### Dominio no confiable: captura

`.github/workflows/e2e.yml` conserva `contents: read` y:

1. instala dependencias, crea el seed y levanta la aplicación como hasta ahora;
2. ejecuta los E2E normales de Chromium;
3. solo si pasan, ejecuta `e2e/visual-preview.e2e.ts`;
4. sube `visual-previews-pr-<PR>-attempt-<N>` como artifact con retención de un día.

Las vistas se definen exclusivamente en `e2e/visual-preview-pages.ts`. Cada entrada contiene un identificador, título, ruta relativa, selector de disponibilidad y un rol de seed opcional. La captura usa Chromium a 1440×900, escala 1, modo claro, movimiento reducido, animaciones y transiciones desactivadas, y página completa.

### Dominio confiable: publicación

`.github/workflows/visual-preview-publish.yml` se dispara al completar satisfactoriamente `E2E Tests` y solo procesa runs cuyo evento original sea `pull_request`. Tiene permisos explícitos:

* `actions: read` para descargar el artifact;
* `contents: write` para gestionar assets de una prerelease;
* `issues: write` para crear o actualizar el comentario del PR.

No hace checkout ni ejecuta archivos, scripts o comandos procedentes del PR. Trata el artifact como entrada no confiable y aplica antes de publicarlo:

* entre 1 y 20 ficheros;
* solo ficheros regulares `.png`;
* nombre `^[a-z0-9][a-z0-9-]{0,63}\.png$`;
* tamaño entre 1 byte y 10 MiB;
* firma binaria PNG `89 50 4e 47 0d 0a 1a 0a`;
* nombre final construido con el número de PR y el SHA proporcionados por GitHub.

Los PNG se almacenan como assets de la prerelease `pr-visual-previews`. Antes de cada publicación se eliminan los assets anteriores del mismo PR. El comentario se identifica mediante `<!-- procomun-visual-previews -->`; cada push actualiza ese comentario en vez de crear otro.

No se incorporan acciones de terceros para capturar o comentar. El workflow privilegiado usa únicamente acciones oficiales de GitHub y `gh`, disponible en el runner alojado.

### Enmienda 2026-07-17 — publicación sin checkout y sin git local

El job de publicación **no hace checkout** (R1). La primera ejecución real falló en
`Publish latest assets` con `failed to run git: fatal: not a git repository`:
`gh release create --target main` y `gh release upload` intentan resolver el
repositorio / la rama con git local.

Mitigación en `.github/workflows/visual-preview-publish.yml`:

* `GH_REPO=${{ github.repository }}` para que `gh` no dependa de `.git`
* creación de la prerelease `pr-visual-previews` solo con `gh api` POST
  (`target_commitish=main`, sin `git rev-parse`)
* subida de assets con el endpoint REST de release assets (`--input` binario)

Se mantiene el invariante de seguridad: ningún checkout ni ejecución de código del PR.

## Riesgos identificados

| ID | Descripción | Severidad | Control |
|---|---|---:|---|
| R1 | Ejecución de código de PR con token de escritura | Alta | Los permisos de escritura existen solo en `workflow_run`, que no hace checkout ni ejecuta contenido del PR. |
| R2 | Artifact manipulado para atacar el workflow privilegiado | Alta | Lista cerrada de tipos, nombres y tamaños; firma PNG; copia con nombres generados; ningún fichero se interpreta ni ejecuta en el runner. |
| R3 | Imagen con datos personales o secretos | Alta | Entorno E2E aislado, usuarios y recursos de seed; no se usan credenciales ni datos de producción. |
| R4 | Dependencia externa comprometida en el workflow privilegiado | Media | Solo acciones oficiales de GitHub; mantener versiones revisadas y aplicar la política general de pinning del repositorio cuando se adopte. |
| R5 | Crecimiento de assets al acumular PR cerrados | Media | Se conserva solo la última captura por PR; definir limpieza periódica o al cierre antes de acercarse al límite operativo de la release. |
| R6 | PNG válido por firma pero malformado | Baja | El runner no decodifica el PNG; GitHub lo sirve como asset. Mantener límites de tamaño y revisar si se añade procesamiento de imágenes. |
| R7 | El publicador falla y el E2E aparece verde | Media | El workflow de publicación es visible como run separado; la verificación end-to-end posterior al merge es obligatoria antes de cerrar #283. |
| R8 | Capturas inestables por fuentes, animación o datos variables | Media | Viewport y preferencias fijas, animaciones desactivadas, selector explícito de disponibilidad y seed determinista. |

No se identifica un bloqueo legal: las imágenes contienen exclusivamente la interfaz y datos ficticios del entorno de test. Si en el futuro se capturan entornos con datos reales, esta ADR deja de ser suficiente y se requiere una revisión RGPD/ENS específica.

## Consecuencias

### Positivas

* Los revisores ven el estado renderizado de cada PR sin reproducir el entorno local.
* El código del PR mantiene token de solo lectura y compatibilidad con la restricción de permisos de forks.
* La lista de rutas puede ampliarse sin modificar workflows.
* Un único comentario conserva una conversación limpia y siempre apunta al último SHA validado.
* Las capturas no se incorporan al historial Git y los assets anteriores del mismo PR se eliminan.
* La solución no introduce una cuenta SaaS, secreto permanente ni aplicación externa.

### Negativas / Riesgos

* Se mantienen aproximadamente 189 líneas de workflow privilegiado que deben revisarse como código sensible.
* La solución muestra evidencia visual, pero no calcula diferencias ni compara contra un baseline.
* La prerelease introduce almacenamiento operativo que necesita política de limpieza para PR cerrados.
* La primera ejecución completa del publicador requiere una PR posterior a la fusión de #284.
* Los assets de release dependen de que GitHub permita su renderizado en el contexto y visibilidad del repositorio.
* Un cambio en el formato de artifacts, API de releases o permisos de GitHub puede requerir mantenimiento.

## Notas de Implementación

* Implementación: PR #284; configuración de vistas en `e2e/visual-preview-pages.ts`.
* Añadir rutas mediante `VISUAL_PREVIEW_PAGES`; no editar los workflows para ampliar la galería.
* Validación realizada en #284: puertas de lint, tracking, tipos, tests y cobertura en verde; 54 E2E Chromium; 5 capturas en 10,8 s; artifact de 1,50 MB.
* Validación pendiente: tras fusionar #284, abrir o actualizar un PR y comprobar la creación de la prerelease, los cinco assets y el comentario actualizable. No cerrar #283 hasta completar esta prueba.
* Limpieza: diseñar un mecanismo que elimine assets de PR cerrados sin hacer checkout ni ejecutar código del PR. Puede ser un workflow confiable basado únicamente en metadatos o una tarea programada.
* Observabilidad: los fallos de publicación quedan en el workflow `Publish Visual Previews`; no deben ocultarse con `continue-on-error`.
* Rollback: retirar el paso de captura de `e2e.yml`, deshabilitar o eliminar `visual-preview-publish.yml`, borrar la prerelease/tag `pr-visual-previews` y retirar el comentario marcador de los PR afectados.
* Reabrir esta ADR si se aprueba Argos u otro servicio, si se requieren comparaciones contra baseline, si las capturas dejan de usar datos de seed o si el volumen de assets exige otro almacenamiento.

## Referencias

* GitHub Docs — Events that trigger workflows (`workflow_run`): https://docs.github.com/actions/using-workflows/events-that-trigger-workflows
* GitHub Docs — Use `GITHUB_TOKEN` for authentication: https://docs.github.com/actions/reference/authentication-in-a-workflow
* GitHub Docs — Secure use reference: https://docs.github.com/actions/reference/security/secure-use
* Auto PR Screenshots: https://github.com/marketplace/actions/auto-pr-screenshots
* Argos Visual Testing: https://github.com/marketplace/argos-ci
* Lost Pixel: https://github.com/marketplace/actions/lost-pixel
* Webshot Archive GitHub Action: https://github.com/marketplace/actions/webshot-archive-github-action
* Issue #283 y PR #284.

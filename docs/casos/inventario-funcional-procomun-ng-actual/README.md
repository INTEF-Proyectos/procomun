# Inventario funcional de la version actual de procomun-ng

> Tipo: Caso de analisis sin implementacion
> Fecha de redaccion: 2026-05-22
> Objetivo: enumerar las funcionalidades implementadas o parcialmente implementadas en la version de `procomun-ng` desarrollada en este repositorio para compararlas con la version actual de Procomun y decidir que conservar, mejorar o priorizar.

## Alcance y metodo

Este documento inventaria el estado funcional del repositorio a partir de codigo y documentacion local. No se ha ejecutado una sesion funcional completa en navegador ni una bateria E2E nueva para este inventario.

Fuentes locales principales:

- `README.md`
- `status.yaml`
- `docs/producto/roadmap.md`
- `docs/producto/arquitectura.md`
- `docs/producto/modelo-de-dominio.md`
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/pages/`
- `apps/frontend/src/islands/`
- `apps/frontend/src/lib/api-client.ts`
- `apps/frontend/src/lib/http-api-client.ts`
- `apps/api/src/app/routes.ts`
- `apps/api/src/routes/public.ts`
- `apps/api/src/routes/social.ts`
- `apps/api/src/routes/admin/`
- `packages/db/src/schema/`
- `packages/db/src/validation.ts`
- `packages/db/src/seed-data.ts`

Limitaciones:

- El inventario distingue entre funcionalidad conectada por API/BD y funcionalidad visible en UI que requiere verificacion.
- La documentacion historica de marzo contiene referencias a Astro, React islands y comentarios sociales que han quedado total o parcialmente supersedidas por la implementacion actual en React Router + Vite.
- Este documento no sustituye a una validacion funcional con `make test`, `bun run test` o Playwright.

## Problema educativo que cubre procomun-ng

`procomun-ng` esta construyendo un sustituto moderno de Procomun orientado a catalogar, publicar, revisar, buscar y reutilizar recursos educativos abiertos con una arquitectura mas simple y mantenible.

Usuario principal:

- Profesorado que busca recursos educativos reutilizables y con metadatos suficientes para decidir rapidamente si encajan en su contexto.

Usuarios secundarios:

- Autores que crean recursos y adjuntan materiales o proyectos `.elpx`.
- Editores que publican directamente contenidos de confianza.
- Curadores que revisan recursos, gestionan colecciones y gobiernan taxonomias.
- Administradores que gestionan usuarios, configuracion y operacion editorial.
- Usuarios lectores que consultan, descargan, valoran y guardan recursos.

## Estado general del producto

La version actual implementa un MVP funcional de catalogo y backoffice editorial. Las capacidades mas consolidadas son:

- Catalogo publico de recursos publicados.
- Busqueda textual con filtros por tipo, idioma y licencia.
- Ficha publica de recurso con metadatos, archivos, previsualizacion `.elpx`, descarga, favoritos y valoraciones.
- Creacion y edicion de recursos para usuarios con rol `author` o superior.
- Flujo editorial de recursos con roles y transiciones.
- Subida resumable multiarchivo y asociacion a `media_items`.
- Analisis, subida, previsualizacion, edicion y generacion de paquetes `.elpx`.
- Colecciones publicas y backoffice de colecciones con asociacion ordenada de recursos.
- Backoffice para recursos, colecciones, taxonomias, usuarios y ajustes de badges.
- Autenticacion con Better Auth, email/password y OIDC configurable.
- I18n de interfaz con rutas localizadas para `es`, `en`, `ca`, `gl` y `eu`.
- Seed de demostracion con datos educativos realistas.

## Volumetria de demo incluida en el repositorio

| Elemento | Volumen en seed | Fuente |
|----------|-----------------|--------|
| Usuarios demo | 12 | `packages/db/src/seed-data.ts` |
| Roles demo | 5 | `reader`, `author`, `editor`, `curator`, `admin` |
| Recursos demo | 22 | Recursos educativos con metadatos y `.elpx` asociados |
| Colecciones demo | 8 | Colecciones publicadas con recursos asociados |
| Valoraciones demo | 40+ | Ratings 1-5 sobre recursos |
| Favoritos demo | 30+ | Favoritos por usuario |
| Descargas simuladas | 20 recursos con contador | Agregados sociales para la demo |

## Inventario de funcionalidades

### 1. Acceso publico, navegacion e idioma

- SPA React con Vite y React Router.
- Rutas publicas principales:
  - `/`
  - `/explorar`
  - `/buscar` redirige a `/explorar`
  - `/recurso?slug=...`
  - `/colecciones`
  - `/ayuda`
  - `/login`
  - `/registro`
  - `/perfil`
- Rutas localizadas para idiomas no predeterminados:
  - `/en/*`
  - `/ca/*`
  - `/gl/*`
  - `/eu/*`
- Idioma por defecto sin prefijo: `es`.
- Navegacion publica con buscador global y acceso a inicio, exploracion, colecciones, ayuda, login/perfil y publicacion segun sesion.
- Layout publico con landmarks, skip link y footer.
- Pagina de ayuda estructurada con secciones de primeros pasos, exploracion, publicacion, colecciones, FAQ, roles, contacto y mapa web.

### 2. Home y descubrimiento inicial

- Home con hero orientado a busqueda de recursos educativos.
- Estadisticas dinamicas desde API:
  - total de recursos publicados,
  - usuarios,
  - colecciones,
  - novedades.
- Bloque de recursos destacados calculados desde configuracion de badges y senales sociales.
- Bloque de colecciones tematicas con carrusel horizontal.
- Bloque de ultimas novedades.
- Previsualizaciones iframe de contenidos `.elpx` cuando existen.
- Enlaces de entrada a catalogo, recurso y colecciones.

### 3. Catalogo publico

- Catalogo publico en `/explorar`.
- Lectura desde `GET /api/v1/resources`.
- Solo se listan recursos publicados.
- Busqueda textual mediante parametro `q`.
- Paginacion con URL como fuente de estado:
  - `page`,
  - query,
  - filtros.
- Filtros dinamicos cargados desde taxonomias:
  - tipo de recurso,
  - idioma,
  - licencia.
- Alternancia entre vista grid y vista lista, persistida en `localStorage`.
- Sidebar de filtros responsive.
- Limpieza de filtros.
- Tarjetas de recurso con:
  - previsualizacion `.elpx` cuando existe,
  - tipo de recurso,
  - idioma,
  - titulo,
  - descripcion recortada,
  - autor o creador,
  - rating medio,
  - contador de favoritos,
  - acciones de favorito y copiar enlace.
- Badges calculados:
  - `Novedad`,
  - `Destacado`.

### 4. Ficha publica de recurso

- Ficha publica en `/recurso?slug=...`.
- Lectura desde `GET /api/v1/resources/:slug`.
- Acceso permitido para recursos publicados y, si aplica, recursos gestionables por el usuario autenticado.
- Cabecera con:
  - estado editorial,
  - fecha,
  - titulo,
  - autor/creador,
  - licencia,
  - enlace de edicion si el usuario puede editar.
- Acciones:
  - ver online cuando hay preview `.elpx`,
  - descargar archivo principal,
  - copiar enlace,
  - marcar/desmarcar favorito,
  - valorar con estrellas.
- Registro de descarga mediante `POST /api/v1/resources/:slug/download`.
- Previsualizacion embebida `.elpx` en iframe.
- Codigo iframe para incrustar el recurso en otra web cuando existe preview.
- Seccion de descripcion.
- Seccion de archivos adjuntos con nombre, icono y tamano.
- Panel lateral de metadatos:
  - tipo,
  - idioma,
  - materias,
  - niveles,
  - fecha,
  - etiquetas.
- Senales sociales:
  - resumen de valoraciones,
  - puntuacion del usuario,
  - favoritos,
  - contador de descargas.

### 5. Creacion de recursos

- Ruta `/nuevo` para usuarios `author` o superior.
- Comprobacion de sesion y rol antes de mostrar el flujo.
- Flujo de alta con dos caminos:
  - subir un archivo `.elpx` o `.elp` para extraer metadatos,
  - crear recurso manualmente como borrador.
- Analisis de `.elpx` mediante `POST /api/admin/elpx/analyze`.
- Extraccion de metadatos del `.elpx` para precargar:
  - titulo,
  - descripcion,
  - autor,
  - idioma,
  - licencia.
- Creacion de recurso via `POST /api/admin/resources`.
- Creacion rapida de borrador via `POST /api/admin/resources/draft`.
- Subida directa del `.elpx` tras crear el recurso mediante `POST /api/admin/elpx/upload/:resourceId`.
- Campos principales de alta:
  - titulo,
  - descripcion,
  - idioma,
  - licencia,
  - tipo de recurso,
  - autor,
  - palabras clave.
- Validacion de campos obligatorios y errores por campo.

### 6. Edicion de recursos

- Ruta `/editar?id=...` para usuarios `author` o superior.
- Carga de recurso por ID desde `/api/admin/resources/:id`.
- Vista de edicion con:
  - cabecera de estado,
  - fecha,
  - enlace a ficha publica,
  - formulario de metadatos,
  - panel lateral de acciones,
  - previsualizacion `.elpx` si existe.
- Edicion de:
  - titulo,
  - descripcion,
  - idioma,
  - licencia,
  - tipo de recurso,
  - autor,
  - palabras clave.
- Guardado mediante `PATCH /api/admin/resources/:id`.
- Aplicacion de metadatos extraidos del `.elpx` sobre el formulario.
- Acceso al editor eXeLearning embebido cuando el recurso tiene proyecto `.elpx`.
- Guardado de cambios hechos en eXeLearning mediante `POST /api/admin/elpx/save/:resourceId`.
- Sustitucion directa de archivo `.elpx` mediante `POST /api/admin/elpx/upload/:resourceId`.

### 7. Flujo editorial de recursos

- Estados implementados:
  - `draft`,
  - `review`,
  - `published`,
  - `archived`.
- Transiciones implementadas:
  - `draft -> review` desde `author`,
  - `draft -> published` desde `editor`,
  - `review -> draft` desde `curator`,
  - `review -> published` desde `curator`,
  - `published -> archived` desde `curator`,
  - `archived -> draft` desde `curator`.
- Validacion compartida en `packages/db/src/validation.ts`.
- Actualizacion de estado mediante `PATCH /api/admin/resources/:id/status`.
- Botones de workflow visibles segun rol y estado.
- Registro de actividad al crear, actualizar, publicar o cambiar estado.
- Autores gestionan sus propios recursos.
- Curadores gestionan recursos propios o asignados.
- Administradores gestionan todos los recursos.

### 8. Subidas, adjuntos y media

- Subidas resumables con TUS bajo `/api/uploads`.
- Panel de subida multiarchivo en el editor de recurso.
- Drag and drop y selector de archivos.
- Cola local, progreso global y estado de subida.
- Validacion de candidato de upload por:
  - extension,
  - MIME,
  - tamano maximo,
  - permisos sobre el recurso.
- Sesiones de upload persistidas en `upload_sessions`.
- Creacion automatica de `media_items` al completar la subida.
- Descarga publica de adjuntos publicados desde `GET /api/v1/uploads/:id/content`.
- Descarga/admin preview de adjuntos desde `GET /api/admin/uploads/:id/content`.
- Cancelacion de uploads desde `DELETE /api/admin/uploads/:id`.
- Eliminacion de adjuntos de un recurso desde `DELETE /api/admin/resources/:id/media/:mediaItemId`.
- Procesado automatico de `.elpx` o `.elp` al finalizar un upload resumable.

### 9. eXeLearning y paquetes `.elpx`

- Servicio estatico de editor eXeLearning bajo `/api/v1/exelearning-editor`.
- Bootstrap de editor con configuracion de integracion, iframe y bridge `postMessage`.
- Apertura del editor en modal desde la pantalla de edicion.
- Guardado de proyecto desde el editor de vuelta a Procomun.
- Extraccion y registro de proyectos `.elpx` en `elpx_projects`.
- Previsualizacion publica de `.elpx` bajo `/api/v1/elpx/:hash/`.
- Generacion automatica de paquete `.elpx` desde adjuntos de un recurso mediante `POST /api/admin/elpx/generate/:resourceId`.
- El `.elpx` generado incluye metadatos basicos del recurso y los archivos adjuntos.
- Regeneracion automatica tras subir adjuntos en algunos flujos de edicion.
- Descarga del archivo `.elpx` asociado.

### 10. Colecciones publicas

- Ruta publica `/colecciones`.
- API publica:
  - `GET /api/v1/collections`,
  - `GET /api/v1/collections/:slug`.
- Listado de colecciones publicadas.
- Busqueda de colecciones por texto.
- Paginacion publica.
- Vista de detalle usando `slug` en query.
- Hero de coleccion con portada, titulo, descripcion, numero de recursos, curador y fecha.
- Listado de recursos asociados a la coleccion.
- Recursos de coleccion con preview `.elpx` cuando existe.
- Colecciones con orden editorial mediante posicion en `collection_resources`.
- Modelo preparado para distinguir colecciones ordenadas como itinerarios mediante `isOrdered`.

### 11. Backoffice editorial

- Ruta `/admin/*`.
- Acceso al backoffice solo para usuarios `curator` o `admin`.
- Secciones principales:
  - dashboard,
  - recursos,
  - colecciones,
  - categorias/taxonomias,
  - usuarios.
- Sidebar administrativo con navegacion por secciones.
- Dashboard con estadisticas:
  - total de recursos,
  - publicados,
  - en revision,
  - borradores,
  - porcentaje publicado.
- Acciones rapidas:
  - gestionar recursos,
  - gestionar colecciones,
  - gestionar categorias,
  - crear recurso.
- Herramientas de desarrollo visibles en entorno local.
- Configuracion de badges desde backoffice:
  - dias para `Novedad`,
  - minimo de valoraciones para `Destacado`,
  - media minima,
  - favoritos minimos.

### 12. Gestion de recursos en backoffice

- Listado administrativo de recursos.
- Estadisticas por estado.
- Busqueda por titulo, autor o palabra clave.
- Filtro por estado:
  - todos,
  - publicado,
  - en revision,
  - borrador.
- Tabla con:
  - titulo,
  - ID parcial,
  - tipo,
  - idioma,
  - estado,
  - autor,
  - fecha de actualizacion,
  - acciones.
- Acciones:
  - editar,
  - eliminar.
- API bajo `/api/admin/resources`.
- Soft delete logico desde repositorio.

### 13. Gestion de colecciones en backoffice

- Gestion reservada a `curator` y `admin`.
- CRUD de colecciones bajo `/api/admin/collections`.
- Creacion de coleccion con:
  - titulo,
  - descripcion,
  - URL de portada,
  - orden fija.
- Edicion de coleccion con:
  - titulo,
  - descripcion,
  - portada,
  - estado editorial,
  - orden fija.
- Busqueda de colecciones.
- Asociacion de recursos existentes a colecciones.
- Eliminacion de recursos de una coleccion.
- Reordenacion de recursos asociados con acciones subir/bajar.
- Conteo de recursos en listados.
- Publicacion de colecciones mediante estado `published`.

### 14. Gestion de taxonomias

- Taxonomias gestionadas en backoffice.
- API bajo `/api/admin/taxonomies`.
- Tipos validos en modelo:
  - `category`,
  - `tag`,
  - `subject`,
  - `level`,
  - `resource-type`,
  - `language`,
  - `license`.
- UI actual centrada en:
  - materia,
  - nivel,
  - etiqueta.
- Busqueda por nombre.
- Filtro por tipo.
- Creacion, edicion y eliminacion.
- Campo opcional `parentId` para jerarquias.
- API publica de taxonomias por tipo: `GET /api/v1/taxonomies/:type`.
- Filtros publicos de catalogo cargan taxonomias para tipo, idioma y licencia.

### 15. Usuarios, autenticacion y roles

- Better Auth integrado bajo `/api/auth/*`.
- Login email/password.
- OIDC configurable con `OIDC_ENABLED`.
- Sesiones por cookie.
- Cierre de sesion.
- Registro de actividad de login y logout.
- Roles implementados:
  - `reader`,
  - `author`,
  - `editor`,
  - `curator`,
  - `admin`.
- Jerarquia numerica:
  - `reader = 0`,
  - `author = 1`,
  - `editor = 2`,
  - `curator = 3`,
  - `admin = 4`.
- Rol por defecto en Better Auth: `author`.
- Administracion de usuarios en backoffice para `admin`.
- Listado de usuarios con busqueda y filtro por rol.
- Edicion de nombre y rol.
- Activacion/desactivacion de usuarios.
- Creacion de usuarios desde backoffice mediante endpoint de sign-up de Better Auth y posterior asignacion de rol.

### 16. Perfil personal

- Ruta `/perfil` protegida por sesion.
- Dashboard personal con:
  - avatar Gravatar,
  - nombre,
  - rol,
  - conteo de publicados,
  - conteo de borradores,
  - conteo de favoritos.
- Edicion de nombre visible en UI.
- Tabs:
  - mis recursos,
  - favoritos,
  - valoraciones,
  - actividad.
- Mis recursos:
  - recursos recientes del usuario,
  - badges de estado,
  - enlace a edicion,
  - accion para crear nuevo recurso.
- Favoritos:
  - listado de recursos guardados,
  - retirada de favorito.
- Valoraciones:
  - recursos valorados por el usuario,
  - puntuacion aplicada.
- Actividad:
  - eventos de creacion,
  - actualizacion,
  - publicacion,
  - cambios de estado,
  - valoraciones,
  - favoritos,
  - subidas,
  - descargas.

### 17. Funcionalidad social ligera

- Valoraciones 1-5 por recurso.
- Un rating unico por usuario y recurso.
- Resumen de valoraciones:
  - media,
  - total,
  - distribucion.
- Favoritos por usuario y recurso.
- Toggle de favorito en catalogo y ficha.
- Listado personal de favoritos.
- Listado personal de valoraciones.
- Tracking de descargas.
- Agregados sociales en tarjetas y ficha:
  - rating,
  - numero de valoraciones,
  - favoritos,
  - descargas.
- Feed de actividad personal.

### 18. Metadatos y modelo de dominio

- Recurso como entidad central.
- Metadatos obligatorios:
  - titulo,
  - descripcion,
  - idioma,
  - licencia,
  - tipo de recurso.
- Metadatos opcionales:
  - palabras clave,
  - autor,
  - editor/publisher,
  - materias,
  - niveles,
  - duracion,
  - rasgos de accesibilidad,
  - peligros de accesibilidad,
  - modo de acceso,
  - ID externo,
  - URI de origen,
  - fuente de importacion.
- Licencias validas:
  - `cc-by`,
  - `cc-by-sa`,
  - `cc-by-nc`,
  - `cc-by-nc-sa`,
  - `cc-by-nc-nd`,
  - `cc-by-nd`,
  - `cc0`.
- Idiomas validos en validacion backend:
  - `es`,
  - `en`,
  - `ca`,
  - `eu`,
  - `gl`,
  - `fr`,
  - `pt`,
  - `de`,
  - `it`.
- UI de formularios centrada actualmente en:
  - `es`,
  - `en`,
  - `ca`,
  - `eu`,
  - `gl`.
- Materias y niveles existen en modelo y visualizacion, pero no estan plenamente integrados en el formulario principal de creacion/edicion.

### 19. API publica

- `GET /health`
- `GET /api/v1/config`
- `GET /api/v1/resources`
- `GET /api/v1/resources/:slug`
- `GET /api/v1/uploads/:id/content`
- `GET /api/v1/taxonomies/:type`
- `GET /api/v1/collections`
- `GET /api/v1/collections/:slug`
- `GET /api/v1/config/badges`
- `GET /api/v1/stats`
- `GET /api/v1/resources/:slug/ratings`
- `POST /api/v1/resources/:slug/ratings`
- `POST /api/v1/resources/:slug/favorite`
- `GET /api/v1/users/me/favorites`
- `GET /api/v1/users/me/ratings`
- `GET /api/v1/users/me/dashboard`
- `GET /api/v1/users/me/activity`
- `POST /api/v1/resources/:slug/download`
- `GET /api/v1/resources/:slug/stats`
- `GET /api/v1/elpx/:hash/*`
- `GET /api/v1/exelearning-editor/*`

### 20. API administrativa

- Todas las rutas bajo `/api/admin/*` requieren autenticacion.
- Recursos:
  - listar,
  - obtener,
  - crear,
  - crear borrador,
  - actualizar,
  - eliminar,
  - cambiar estado,
  - listar media,
  - eliminar media,
  - listar uploads,
  - consultar proyecto `.elpx`.
- Uploads:
  - configuracion,
  - descarga admin,
  - cancelacion.
- Colecciones:
  - CRUD,
  - listar recursos asociados,
  - asociar recurso,
  - quitar recurso,
  - reordenar recurso.
- Taxonomias:
  - CRUD,
  - filtro por tipo.
- Usuarios:
  - listar,
  - obtener,
  - actualizar nombre, rol y estado.
- eXeLearning:
  - analizar `.elpx`,
  - subir `.elpx`,
  - guardar `.elpx`,
  - generar `.elpx`.
- Ajustes:
  - obtener settings,
  - actualizar settings.

### 21. Operacion, desarrollo y calidad

- Monorepo TypeScript con Bun.
- Apps:
  - `apps/api`,
  - `apps/frontend`,
  - `apps/cli`.
- Paquete compartido:
  - `packages/db`.
- Base de datos:
  - PostgreSQL como base principal,
  - PGlite por defecto en desarrollo local.
- Docker Compose con servicio `db` PostgreSQL y servicio `app`.
- Servicio integrado API + frontend para despliegue app.
- Dev local con API y Vite separados.
- CLI con comandos:
  - `seed`,
  - `seed:resources`,
  - `user:create`,
  - `user:list`.
- Panel de desarrollo estatico en `/dev/` para consultar estado, ADRs y documentacion.
- Testing configurado:
  - paridad archivo productivo/test,
  - unit,
  - integration,
  - coverage,
  - Playwright E2E,
  - preflight E2E.
- Lint y formato con Biome.
- Contrato visual `DESIGN.md` validable con `bun run design:lint`.

## Funcionalidades parciales o que requieren verificacion

- Ordenacion del catalogo: la UI permite alternar entre relevancia y recientes, pero el backend no recibe todavia un parametro de ordenacion.
- Registro publico: existe pagina `/registro`, pero la implementacion actual del formulario llama a `signIn`, no a `sign-up`; requiere correccion o validacion funcional antes de considerarlo completado.
- Bio de perfil: la UI permite editar bio, pero el endpoint usado actualiza nombre y no persiste claramente `bio`.
- Eliminacion de usuarios: la UI tiene boton de eliminar usuario, pero en las rutas admin revisadas no aparece un `DELETE /api/admin/users/:id`; la accion requiere verificacion/correccion.
- Comentarios: hay referencias historicas en documentos y estilos, pero en el codigo actual conectado se observan ratings, favoritos, descargas y actividad; no se observa API/esquema operativo de comentarios.
- Materias y niveles: existen en esquema y ficha, pero no estan completamente integrados en formularios ni en facetas publicas principales.
- Colecciones como itinerarios: el modelo tiene `isOrdered`, pero no existe todavia una experiencia diferenciada de itinerario didactico con pasos, objetivos o narrativa.
- Banco Multimedia: hay `media_items` asociados a recursos, pero no existe un Banco Multimedia independiente comparable al Procomun actual.
- App movil: no existe app movil en este repositorio.
- Articulos, boletines y comunidades: no existen como modulos funcionales propios en la version actual.
- Moderacion avanzada: existe flujo editorial de recursos, pero no un modulo completo de denuncias, comentarios, revision de calidad campo a campo o colas editoriales avanzadas.
- Migracion/importacion: el analisis legacy esta documentado, pero la importacion CSV, OAI-PMH y ETL desde Procomun no estan implementados.

## Comparacion rapida con la version actual de Procomun

### Ya cubierto o mejorado en procomun-ng

- Catalogo publico de recursos.
- Busqueda con filtros basicos.
- Ficha de recurso con metadatos, descarga y previsualizacion.
- Creacion y edicion de recursos por usuarios autenticados.
- Flujo editorial formalizado por estados y roles.
- Colecciones como entidad propia, con asociacion directa de recursos.
- Subidas resumables multiarchivo.
- Integracion tecnica con `.elpx` y eXeLearning online.
- Autenticacion con email/password y OIDC configurable.
- Backoffice unificado.
- I18n de interfaz para los idiomas principales de Procomun.
- Seed de demo y entorno local reproducible.

### Cubierto parcialmente

- Busqueda facetada: existe para tipo, idioma y licencia; faltan materia, nivel, conteos y ranking avanzado.
- Banco Multimedia: hay adjuntos/media por recurso; falta entidad multimedia independiente.
- Itinerarios: se pueden modelar como colecciones ordenadas; falta experiencia especifica de itinerario.
- Perfil: existe dashboard personal; faltan visibilidad publica rica, curriculum, privacidad granular y datos personales completos.
- Social: existen favoritos, valoraciones, descargas y actividad; faltan comunidades, comentarios y participacion social completa.
- Administracion: CRUD principal existe; faltan informes editoriales, moderacion avanzada y operaciones mas profundas.

### No cubierto actualmente

- Comunidades.
- Articulos editoriales.
- Boletines.
- App movil.
- OAI-PMH servidor/cliente.
- Exportacion bulk.
- Integracion LTI/Moodle.
- Recomendaciones.
- Analitica de uso y calidad.
- Observabilidad y alertas.
- Migracion automatizada desde Procomun legacy.

## Punto de partida para priorizacion

### Funcionalidades a conservar

- Catalogo publico con busqueda, filtros, ficha y descarga.
- Flujo editorial por roles.
- Backoffice unico.
- Colecciones como entidad independiente.
- Subidas resumables y media asociada.
- Integracion `.elpx` con preview y editor.
- Perfil con recursos, favoritos, valoraciones y actividad.
- I18n de interfaz.
- API publica versionada.
- Arquitectura monorepo TypeScript/Bun con PGlite local y PostgreSQL real.

### Funcionalidades a mejorar

- Facetas: anadir materia, nivel, conteos, combinacion mas rica y ordenacion real.
- Metadatos: integrar materias/niveles en formularios y validacion editorial.
- Registro: corregir o cerrar el flujo publico de alta.
- Perfil: persistir bio y ampliar preferencias de visibilidad.
- Usuarios: cerrar eliminacion o sustituirla por desactivacion formal.
- Colecciones/itinerarios: darles una experiencia didactica diferenciada si se quieren cubrir itinerarios legacy.
- Moderacion: crear cola editorial, motivos de rechazo, observaciones y reglas de calidad.
- Social: decidir si se implementan comentarios o si se descartan frente a valoraciones/favoritos.
- Banco Multimedia: decidir si se convierte `media_items` en entidad reutilizable o se mantiene solo como adjunto.

### Funcionalidades que requieren decision de producto

- Si `procomun-ng` debe replicar comunidades o sustituirlas por colecciones curatoriales y perfiles.
- Si articulos y boletines entran en alcance o se delegan a un CMS externo.
- Si el Banco Multimedia debe ser producto propio o una vista del catalogo de media.
- Si se mantiene compatibilidad con SCORM/IMS/ePUB ademas de `.elpx`.
- Si se construye app movil/PWA o se confia en web responsive.
- Si se prioriza migracion historica completa o migracion selectiva de recursos de mayor valor.
- Si la interaccion social se limita a favoritos/ratings o incluye comentarios, seguimiento y comunidades.

## Siguiente paso recomendado

Cruzar este documento con `docs/casos/inventario-funcional-procomun-actual/README.md` y crear una matriz de decision por funcionalidad:

- `mantener como esta`,
- `mejorar antes de migrar`,
- `implementar porque falta`,
- `descartar o sustituir`,
- `validar con usuario/INTEF`.

Esa matriz deberia alimentar el roadmap de Fase 2 y priorizar, como minimo, busqueda/facetas, metadatos completos, migracion, Banco Multimedia, itinerarios y decision sobre comunidades/articulos.

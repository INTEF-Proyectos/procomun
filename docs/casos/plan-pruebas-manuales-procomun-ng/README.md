# Plan de pruebas manuales de procomun-ng

> Tipo: Plan de validacion manual sin implementacion
> Fecha de redaccion: 2026-05-22
> Objetivo: comprobar manualmente que la aplicacion funciona de extremo a extremo, mas alla de los tests automatizados, cubriendo experiencia publica, autenticacion, publicacion, flujo editorial, perfil, backoffice, colecciones, taxonomias, usuarios, subidas, eXeLearning, accesibilidad y responsive.

## Alcance

Este plan cubre la version actual desarrollada en el repositorio:

- Frontend React Router + Vite.
- API Hono bajo `/api/v1`, `/api/admin`, `/api/auth`, `/api/uploads` y `/api/dev`.
- Catalogo publico, home, ficha de recurso, colecciones, ayuda e idiomas.
- Login, registro, perfil personal y permisos por rol.
- Creacion, edicion, uploads, preview `.elpx` y flujo editorial de recursos.
- Backoffice de recursos, colecciones, taxonomias, usuarios, badges y herramientas locales de desarrollo.
- Validacion manual de accesibilidad, responsive, rendimiento percibido y estados de error.

Quedan fuera de alcance como verificacion funcional cerrada porque no estan implementados como modulos completos:

- Banco Multimedia independiente.
- Comunidades.
- Articulos.
- Boletines.
- App movil nativa.
- OAI-PMH, exportacion bulk y migracion legacy automatizada.

## Preparacion del entorno

### Entorno recomendado

Usar una base limpia y datos demo antes de empezar:

```bash
make down
make up
```

Si no se quiere descargar eXeLearning o se desea separar servicios:

```bash
bun install
bun run --filter '@procomun/cli' cli -- seed
bun run dev:api
bun run dev:frontend
```

URLs esperadas:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- Healthcheck: `http://localhost:3000/health`

Antes de ejecutar el plan:

1. Abrir DevTools del navegador.
2. Activar la pestana `Console` y `Network`.
3. Registrar como defecto cualquier error rojo no explicado, peticion 4xx/5xx inesperada, warning bloqueante de accesibilidad o recurso roto.
4. Ejecutar en ventana normal y repetir los casos criticos en ventana privada para validar sesiones limpias.

### Navegadores y dispositivos

Matriz minima:

| Navegador/dispositivo | Cobertura |
|-----------------------|-----------|
| Chrome/Chromium desktop | Ejecucion completa del plan |
| Firefox desktop | Smoke publico, login, catalogo, recurso, perfil y backoffice |
| Mobile viewport 390x844 | Navegacion publica, catalogo, ficha, perfil, formularios y backoffice basico |
| Tablet viewport 768x1024 | Catalogo, colecciones, ficha, editor y backoffice |

### Cuentas demo

| Rol | Email | Password | Uso en pruebas |
|-----|-------|----------|----------------|
| Admin | `admin@example.com` | `password` | Backoffice completo, usuarios, roles, badges |
| Curator | `curator@example.com` | `password` | Backoffice editorial, recursos, colecciones, taxonomias |
| Editor | `editor@example.com` | `password` | Crear y publicar directamente recursos |
| Author | `author@example.com` | `password` | Crear borrador, enviar a revision, editar recursos propios |
| Reader | `reader@example.com` | `password` | Perfil lector, favoritos, ratings, sin publicacion |

## Criterios generales de aceptacion

Una prueba manual se considera correcta si:

- La pantalla carga sin errores de consola no justificados.
- El contenido principal aparece en menos de 3 segundos en entorno local normal.
- Los datos mostrados coinciden con la accion realizada o con el seed.
- Las acciones bloqueadas por permisos redirigen o muestran mensaje claro.
- Los formularios validan campos obligatorios y no pierden datos sin avisar.
- Las URLs reflejan busquedas, filtros, paginacion o secciones cuando corresponde.
- La navegacion por teclado permite alcanzar acciones principales.
- No hay solapamientos, textos cortados, scroll horizontal accidental ni botones inaccesibles en mobile.
- Los cambios persisten tras recargar la pagina.
- Las acciones destructivas piden confirmacion.

## Plantilla de ejecucion

Plantilla reutilizable: `docs/casos/plan-pruebas-manuales-procomun-ng/plantilla-ejecucion.md`.

Usar una fila por caso ejecutado:

| Caso | Rol | Navegador | Resultado | Evidencia | Defecto |
|------|-----|-----------|-----------|-----------|---------|
| MP-XX | author | Chromium | OK / KO / Bloqueado | captura, URL, request | enlace o descripcion |

Severidad sugerida:

- `S1 bloqueante`: impide login, carga principal, publicacion, datos o backoffice.
- `S2 alta`: rompe un flujo principal pero existe alternativa.
- `S3 media`: error funcional acotado, inconsistencia de permisos, validacion o persistencia.
- `S4 baja`: texto, estilo, accesibilidad menor o mejora UX.

## Orden recomendado de ejecucion

1. Smoke tecnico y entorno.
2. Navegacion publica anonima.
3. Catalogo, busqueda, filtros y ficha de recurso.
4. Autenticacion, registro y permisos.
5. Perfil y social ligero.
6. Creacion/edicion de recursos y flujo editorial por roles.
7. Uploads y eXeLearning.
8. Colecciones publicas y backoffice de colecciones.
9. Backoffice de recursos, taxonomias, usuarios y badges.
10. Accesibilidad, responsive y regresion final.

## Casos de prueba manual

### MP-01 Smoke tecnico del entorno

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `http://localhost:3000/health`. | Devuelve JSON con `status: ok`. |
| Abrir `http://localhost:5173`. | La home carga sin pantalla en blanco. |
| Revisar Network. | No hay 500 en `/api/v1/resources`, `/api/v1/collections`, `/api/v1/stats` ni assets principales. |
| Recargar la home con cache desactivada. | La app vuelve a renderizar y los contadores aparecen. |

### MP-02 Navegacion publica e idioma

| Paso | Resultado esperado |
|------|--------------------|
| Desde home, usar enlaces de navegacion a `Explorar`, `Colecciones`, `Ayuda`, `Login`. | Cada pagina carga y mantiene layout publico con cabecera y footer. |
| Abrir `/buscar`. | Redirige a `/explorar`. |
| Abrir `/en/explorar`, `/ca/explorar`, `/gl/explorar`, `/eu/explorar`. | La ruta carga y `html lang` coincide con el prefijo. |
| Probar enlace de salto al contenido con teclado. | El foco salta al contenido principal. |
| Abrir una ruta inexistente simple. | No debe romper la SPA ni dejar pantalla en blanco. Registrar comportamiento real. |

### MP-03 Home y descubrimiento inicial

| Paso | Resultado esperado |
|------|--------------------|
| Cargar home anonima. | Se ven buscador/hero, estadisticas, recursos destacados, colecciones y novedades si el seed esta cargado. |
| Usar buscador global con un termino presente en seed, por ejemplo `robot` o `clima`. | Navega al catalogo con busqueda aplicada o muestra resultados relevantes. |
| Abrir un recurso destacado. | Navega a `/recurso?slug=...` y muestra la ficha. |
| Mover carrusel de colecciones. | Los controles responden, no hay saltos visuales ni scroll horizontal accidental de pagina. |
| Comprobar iframes `.elpx` en tarjetas. | No aparecen iframes en blanco persistentes ni errores de carga visibles. |

### MP-04 Catalogo publico: busqueda, filtros y paginacion

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/explorar`. | Lista recursos publicados, total y controles de vista. |
| Buscar `robot`. | La URL refleja `q` o estado equivalente; resultados cambian y no hay error. |
| Limpiar busqueda. | Vuelve el listado general. |
| Aplicar filtro de tipo. | La URL conserva el filtro y los resultados lo respetan. |
| Aplicar filtro de idioma. | Solo aparecen recursos del idioma filtrado o mensaje vacio correcto. |
| Aplicar filtro de licencia. | Solo aparecen recursos de la licencia filtrada o mensaje vacio correcto. |
| Combinar varios filtros. | La UI conserva todos los filtros y permite limpiarlos. |
| Cambiar entre grid/list. | La preferencia se mantiene al recargar por `localStorage`. |
| Usar paginacion anterior/siguiente. | Cambia la pagina sin perder busqueda/filtros; botones se deshabilitan correctamente en extremos. |
| Probar busqueda sin resultados. | Muestra estado vacio claro, sin errores de consola. |

### MP-05 Ficha publica de recurso

| Paso | Resultado esperado |
|------|--------------------|
| Abrir un recurso publicado desde catalogo. | Carga titulo, autor, estado, licencia, descripcion y metadatos laterales. |
| Ver preview `.elpx` si existe. | El iframe carga contenido navegable y no queda en blanco. |
| Usar `Ver online` o accion equivalente. | Abre la preview o desplaza a ella sin error. |
| Copiar enlace. | El portapapeles recibe la URL o se muestra feedback claro si el navegador lo bloquea. |
| Revisar codigo iframe. | Se muestra solo cuando hay preview y contiene URL correcta. |
| Descargar archivo principal o adjunto. | Se inicia descarga y la llamada registra contador si aplica. |
| Abrir slug inexistente. | Muestra 404 funcional o mensaje "Recurso no encontrado", no pantalla rota. |
| Abrir recurso no publicado como anonimo si se conoce URL. | No se muestra contenido privado; debe responder como no encontrado o acceso bloqueado. |

### MP-06 Login, logout y sesion

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/login`. | Formulario visible y cuentas demo autocompletables. |
| Login con credenciales incorrectas. | Muestra error claro y no crea sesion. |
| Login como `reader@example.com`. | Redirige a `/perfil`; nav cambia a estado autenticado. |
| Recargar `/perfil`. | La sesion persiste. |
| Cerrar sesion desde navegacion. | Vuelve a estado anonimo y rutas privadas redirigen a login. |
| Intentar `/admin` como anonimo. | Redirige a login. |
| Intentar `/admin` como reader/author/editor. | Redirige a perfil o bloquea acceso. |
| Intentar `/nuevo` como reader. | Muestra mensaje de necesidad de rol author o superior. |

### MP-07 Registro publico

Este caso esta marcado como riesgo conocido porque la implementacion observada del formulario parece llamar a `signIn` en vez de `sign-up`.

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/registro`. | Formulario con nombre, email y password carga sin error. |
| Enviar campos vacios. | El navegador o UI bloquea el envio. |
| Enviar email nuevo y password valido. | Resultado esperado de producto: cuenta creada y redireccion a perfil. |
| Si aparece error de credenciales o no se crea usuario. | Registrar defecto `S2 alta`: registro no crea cuenta nueva. |
| Tras registro supuestamente exitoso, cerrar sesion y entrar con la nueva cuenta. | Debe permitir login y mostrar rol por defecto esperado. |

### MP-08 Perfil personal y social ligero

| Paso | Resultado esperado |
|------|--------------------|
| Login como author. Abrir `/perfil`. | Se ve avatar, nombre, rol, contadores, tabs y recursos propios. |
| Editar nombre y bio. | Resultado esperado: datos guardados y persistentes tras recarga. Si bio no persiste, registrar defecto conocido. |
| Abrir tab `Mis recursos`. | Lista recursos propios y enlaces de edicion. |
| Abrir tab `Favoritos`. | Lista favoritos; permite retirar uno y actualiza contador. |
| Abrir tab `Valoraciones`. | Lista recursos valorados con puntuacion. |
| Abrir tab `Actividad`. | Muestra eventos de creacion, publicacion, favoritos, ratings, uploads o descargas. |
| Marcar favorito desde catalogo/ficha y volver a perfil. | El recurso aparece en favoritos. |
| Valorar recurso desde ficha y volver a perfil. | La valoracion aparece y la media se actualiza de forma razonable. |

### MP-09 Creacion de recurso manual

| Paso | Resultado esperado |
|------|--------------------|
| Login como author y abrir `/nuevo`. | Aparece flujo de subida `.elpx` o creacion manual. |
| Elegir `Crear recurso manualmente`. | Se crea borrador y redirige a `/editar?id=...&new=1`. |
| Dejar titulo/descripcion vacios y guardar. | Muestra errores por campo. |
| Completar titulo, descripcion, idioma, licencia, tipo, autor y keywords. | Guardado correcto con feedback. |
| Recargar editor. | Los cambios persisten. |
| Abrir perfil. | El recurso aparece en `Mis recursos` como borrador. |
| Intentar abrir ficha publica como anonimo. | No debe verse si sigue en borrador. |

### MP-10 Flujo editorial por rol

Ejecutar con un recurso nuevo o recurso de prueba para no alterar datos relevantes.

| Rol | Paso | Resultado esperado |
|-----|------|--------------------|
| Author | Desde borrador, pulsar `Enviar a revision`. | Estado cambia a `review`; aparece feedback. |
| Author | Intentar publicar directamente. | No debe existir boton ni permitirse por API/UI. |
| Editor | Crear recurso manual y pulsar `Publicar directamente`. | Estado cambia a `published`. |
| Curator | Abrir recurso en `review` desde admin o URL de edicion. | Puede `Aprobar` o `Devolver a borrador`. |
| Curator | Aprobar recurso. | Estado `published`; ficha publica accesible como anonimo. |
| Curator | Archivar recurso publicado. | Estado `archived`; deja de aparecer en catalogo publico. |
| Curator | Restaurar archivado a borrador. | Estado vuelve a `draft`. |
| Admin | Repetir aprobacion/archivo. | Tiene permisos equivalentes o superiores a curator. |

### MP-11 Uploads y adjuntos

| Paso | Resultado esperado |
|------|--------------------|
| En editor de recurso, seleccionar varios archivos pequenos. | Aparecen en cola local y progreso global. |
| Subir archivo permitido. | Al completar aparece en `Archivos adjuntos` o `Uploads recientes`. |
| Subir archivo con extension o tamano no permitido. | Muestra error comprensible y no crea adjunto corrupto. |
| Recargar editor. | Adjuntos persistidos aparecen. |
| Eliminar adjunto. | Pide confirmacion o feedback, desaparece y no se descarga desde ficha. |
| Publicar recurso con adjunto y abrir ficha anonima. | El adjunto es descargable solo si el recurso esta publicado. |
| Cortar red durante una subida pequena si es viable. | El estado no deja UI bloqueada; registrar comportamiento real de reanudacion. |

### MP-12 eXeLearning y `.elpx`

| Paso | Resultado esperado |
|------|--------------------|
| En `/nuevo`, subir un `.elpx` demo o valido. | Se analizan metadatos y se precargan campos. |
| Crear recurso desde `.elpx`. | Recurso queda creado y archivo asociado. |
| Abrir editor del recurso. | Hay preview `.elpx` y opcion de editor eXeLearning si el proyecto esta disponible. |
| Abrir editor eXeLearning embebido. | Modal/iframe carga sin error de consola bloqueante. |
| Guardar desde editor si el flujo esta operativo. | El recurso conserva proyecto y preview tras recarga. |
| Generar `.elpx` desde adjuntos si la accion esta visible. | El paquete se genera o muestra error controlado. |
| Abrir `/api/v1/elpx/:hash/` desde preview. | El contenido se sirve sin 404. |

### MP-13 Colecciones publicas

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/colecciones`. | Lista colecciones publicadas con total y buscador. |
| Buscar una coleccion por texto. | Resultados se filtran o muestra vacio correcto. |
| Usar paginacion si hay suficientes colecciones. | Cambia pagina sin perder busqueda. |
| Abrir detalle de coleccion. | Se ve titulo, descripcion, portada si existe, curador, fecha y recursos asociados. |
| Abrir recurso asociado. | Navega a ficha publica. |
| Abrir slug de coleccion inexistente si se puede manipular URL. | Muestra error controlado. |

### MP-14 Backoffice: acceso y dashboard

| Paso | Resultado esperado |
|------|--------------------|
| Login como curator y abrir `/admin`. | Carga panel de gestion sin seccion usuarios. |
| Revisar tarjetas de estadisticas. | Totales coherentes con seed y estados. |
| Usar acciones rapidas a recursos, colecciones y categorias. | Cambia seccion y URL `?section=...`. |
| Guardar configuracion de badges con valores validos. | Muestra `Configuracion guardada` y persiste tras recarga. |
| Login como admin. | Aparece seccion usuarios ademas del resto. |
| En localhost, revisar herramientas de desarrollo. | Se muestran solo en localhost; ejecutar generacion solo si se acepta alterar datos de prueba. |

### MP-15 Backoffice: recursos

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/admin?section=resources`. | Tabla con recursos, estados, autor, fecha y acciones. |
| Buscar por titulo o autor. | Filtra resultados. |
| Filtrar por `Publicado`, `En Revision`, `Borrador`. | Tabla y contadores son coherentes. |
| Editar recurso desde accion. | Navega a `/editar?id=...`. |
| Eliminar un recurso de prueba. | Pide confirmacion y desaparece del listado; no aparece en catalogo si estaba publicado. |
| Intentar eliminar y cancelar. | No cambia el listado. |
| Probar paginacion. | Mantiene filtros y no duplica filas. |

### MP-16 Backoffice: colecciones

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/admin?section=collections` como curator/admin. | Se ve formulario de nueva coleccion y listado. |
| Crear coleccion con titulo, descripcion y orden fija. | Aparece feedback y la coleccion se lista. |
| Editar coleccion. | Modal carga datos, permite cambiar estado, portada, descripcion y orden fija. |
| Buscar recursos dentro del modal. | Devuelve recursos no asociados. |
| Anadir recurso a coleccion. | Aparece en tabla de recursos de la coleccion. |
| Reordenar con subir/bajar. | Cambia posicion y persiste al reabrir modal. |
| Quitar recurso. | Desaparece de la coleccion. |
| Publicar coleccion. | Debe aparecer en `/colecciones`. |
| Eliminar coleccion de prueba. | Pide confirmacion y desaparece del listado publico/admin. |

### MP-17 Backoffice: taxonomias

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/admin?section=categories`. | Lista materias, niveles y etiquetas. |
| Buscar taxonomia por nombre. | Filtra resultados. |
| Filtrar por `Materia`, `Nivel`, `Etiqueta`. | Solo muestra tipo seleccionado. |
| Crear taxonomia nueva. | Aparece en listado con slug generado. |
| Editar nombre/tipo/padre si aplica. | Cambios persisten tras recarga. |
| Eliminar taxonomia de prueba. | Pide confirmacion y desaparece. |
| Intentar crear duplicado o nombre vacio. | Muestra error controlado o bloqueo de formulario. |

### MP-18 Backoffice: usuarios

Ejecutar solo con admin.

| Paso | Resultado esperado |
|------|--------------------|
| Abrir `/admin?section=users`. | Lista usuarios, roles, estado y acciones. |
| Buscar por nombre/email. | Filtra resultados. |
| Filtrar por rol. | Tabla muestra solo ese rol. |
| Crear usuario nuevo con email unico y password >= 8. | Usuario aparece en listado. |
| Editar nombre y rol del usuario de prueba. | Cambios persisten. |
| Desactivar usuario de prueba. | Estado cambia a inactivo; validar que no puede iniciar sesion o que queda bloqueado si esa regla esta implementada. |
| Reactivar usuario. | Estado vuelve a activo. |
| Probar eliminar usuario de prueba. | Resultado esperado de producto: se elimina o se informa que no esta permitido. Si el boton no funciona por falta de endpoint, registrar defecto `S3 media`. |
| Confirmar que usuarios admin no muestran accion destructiva. | No se permite eliminar admin desde UI. |

### MP-19 Permisos y seguridad funcional

| Paso | Resultado esperado |
|------|--------------------|
| Como anonimo, llamar rutas privadas desde navegador: `/perfil`, `/nuevo`, `/editar?id=...`, `/admin`. | Redireccion o mensaje de acceso requerido. |
| Como reader, intentar crear recurso. | Bloqueado. |
| Como author, intentar abrir `/admin`. | Redirige a perfil. |
| Como editor, intentar abrir `/admin`. | Redirige a perfil. |
| Como curator, abrir seccion usuarios por URL directa. | No debe mostrar gestion de usuarios. |
| Como author, intentar editar recurso de otro autor si se conoce ID. | Debe bloquear o no permitir cambios. |
| Como anonimo, intentar valorar o favorito desde ficha. | Debe pedir login o bloquear de forma clara. |
| Revisar cookies de sesion. | No hay datos sensibles visibles en localStorage/sessionStorage. |

### MP-20 API smoke manual

Estos checks no sustituyen tests automatizados, pero ayudan a detectar fallos de integracion durante pruebas manuales.

| Endpoint | Resultado esperado |
|----------|--------------------|
| `GET /health` | `200`, `{ status: "ok" }`. |
| `GET /api/v1/config` | `200`, JSON con configuracion OIDC. |
| `GET /api/v1/resources?limit=5` | `200`, lista paginada. |
| `GET /api/v1/resources/:slug` | `200` para publicado, `404` para inexistente/no visible. |
| `GET /api/v1/taxonomies/resource-type` | `200`, lista de taxonomias. |
| `GET /api/v1/collections?limit=5` | `200`, lista paginada. |
| `GET /api/v1/config/badges` | `200`, umbrales numericos. |
| `GET /api/v1/users/me/dashboard` sin sesion | `401` o bloqueo esperado. |
| `GET /api/admin/resources` sin sesion | `401` o redireccion/bloqueo esperado. |

## Accesibilidad manual

Ejecutar al menos sobre home, catalogo, ficha, login, perfil, editor y admin.

| Check | Resultado esperado |
|-------|--------------------|
| Navegar solo con Tab y Shift+Tab. | El foco es visible, orden logico y no queda atrapado salvo modal abierto. |
| Abrir/cerrar modales de coleccion, usuario y confirmacion. | Foco entra al modal, Escape/cerrar funciona y vuelve a accion previa. |
| Formularios con error. | Error asociado al campo y anunciado por lector cuando aplica. |
| Contraste visual. | Texto y controles legibles en desktop/mobile. |
| Zoom 200%. | No se solapan textos, cabeceras, botones ni tablas principales. |
| Reducir a mobile. | No hay scroll horizontal accidental; filtros y tablas siguen usables. |
| Iframes `.elpx`. | Tienen contexto visual suficiente y no bloquean teclado global. |

## Responsive y compatibilidad visual

| Area | Desktop | Tablet | Mobile |
|------|---------|--------|--------|
| Home | Hero, stats, colecciones, novedades sin solapes | Carrusel usable | Nav y CTA no se pisan |
| Catalogo | Sidebar + grid/list | Sidebar responsive | Filtros accesibles y tarjetas legibles |
| Ficha recurso | Dos columnas si hay espacio | Reflujo correcto | Metadatos y acciones no se solapan |
| Perfil | Tabs y tarjetas legibles | Reflujo correcto | Edicion de perfil usable |
| Editor | Formulario y uploads legibles | Reflujo correcto | Acciones de workflow accesibles |
| Admin | Sidebar y tablas completas | Scroll de tabla controlado | Al menos consulta/acciones basicas sin ruptura visual |

## Rendimiento percibido

Medicion manual recomendada en Chrome DevTools:

| Escenario | Umbral orientativo local |
|-----------|--------------------------|
| Home cold load | Sin pantalla en blanco persistente; contenido principal < 3s |
| Catalogo con seed | Primera lista < 3s |
| Cambio de filtro | Feedback visual inmediato; resultados < 2s |
| Ficha con `.elpx` | Metadatos primero; iframe puede cargar despues sin bloquear pagina |
| Admin recursos | Tabla inicial < 3s |
| Upload pequeno | Progreso visible en < 1s tras seleccionar archivo |

Registrar como defecto cualquier waterfall bloqueante, descarga excesiva inesperada o render en blanco.

## Pruebas de regresion final

Al terminar cambios o correcciones derivadas de esta bateria:

1. Reejecutar MP-01 a MP-06 como smoke minimo.
2. Reejecutar el flujo completo MP-09 -> MP-10 -> MP-05 para confirmar alta, publicacion y ficha publica.
3. Reejecutar MP-14 a MP-18 si se toco backoffice o permisos.
4. Reejecutar MP-11/MP-12 si se tocaron uploads, adjuntos o `.elpx`.
5. Repetir mobile para home, catalogo, ficha, perfil y editor.

## Defectos esperables a confirmar

Estos puntos ya aparecen como sospecha en el inventario funcional y deben confirmarse manualmente:

| Area | Riesgo | Caso |
|------|--------|------|
| Registro | `/registro` puede estar usando login en lugar de alta real. | MP-07 |
| Perfil | Bio puede no persistir si el endpoint solo actualiza nombre. | MP-08 |
| Usuarios admin | Boton eliminar usuario puede no tener endpoint backend. | MP-18 |
| Catalogo | Ordenacion visible puede no estar conectada a backend si aparece en UI. | MP-04 |
| Comentarios | No hay modulo operativo conectado; no considerarlo fallo si no aparece. | Fuera de alcance |
| Materias/niveles | Pueden verse en ficha pero no estar como facetas principales. | MP-04, MP-05 |

## Cierre de ejecucion

Para dar la bateria por cerrada:

- Todos los casos `P0/S1` y flujos principales deben estar `OK` o con defecto aceptado por producto.
- Los defectos `S2 alta` deben tener decision: corregir antes de demo, posponer o excluir.
- Los defectos visuales/accesibilidad deben incluir captura, viewport, navegador y ruta.
- Cualquier dato creado para prueba debe quedar documentado o limpiarse con nuevo seed.
- Si se usa `make up` con base local, anotar si se ejecuto `make down` al final.

## Ampliación 2026-11-16 — MP-08 «Mis recursos» completo (#530)

| Paso | Resultado esperado |
|------|--------------------|
| Login como author con más de 12 recursos propios. Abrir `/perfil`, pestaña `Mis recursos`. | Aparecen 12 tarjetas y la paginación; «Todos (n)» coincide con el contador de la pestaña. |
| Elegir cada estado: publicados, borradores, en revisión y archivados. | Cada lista tiene tantos recursos como su contador; la suma de los cuatro es «Todos». |
| Escribir parte de un título en «Buscar en mis recursos». | La lista se filtra; los contadores de estado pasan a contar solo lo que coincide. |
| Abrir «Más filtros» y elegir tipo, etapa, área o etiqueta. «Limpiar filtros». | Se filtra; al limpiar vuelve la lista completa del estado elegido y se vacía el buscador. |
| En una tarjeta, «Editar». | Abre `/editar?id=…` del recurso. |
| En una tarjeta, «Eliminar», y «Cancelar» o Escape. | Se abre un diálogo propio (no el `confirm` del navegador); al cancelar no se borra y el foco vuelve al botón. |
| «Eliminar» y confirmar. | El recurso desaparece, se anuncia «Se ha eliminado…», bajan los contadores del perfil y de la pestaña. |
| Repetir con teclado y lector de pantalla. | Todos los controles se alcanzan con Tab, tienen nombre accesible y foco visible. |

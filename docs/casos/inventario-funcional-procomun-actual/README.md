# Inventario funcional de la version actual de Procomun

> Tipo: Caso de analisis sin implementacion
> Fecha de redaccion: 2026-05-22
> Objetivo: enumerar las funcionalidades de la version publica actual de Procomun para usarlas como punto de partida en la definicion de funcionalidades a conservar, mejorar o sustituir en `procomun-ng`.

## Alcance y metodo

Este documento consolida funcionalidades observables o documentadas de la version actual de Procomun. Se ha redactado desde fuentes publicas, sin acceso a cuentas internas ni paneles de administracion.

Fuentes principales:

- Portada actual de Procomun: <https://procomun.intef.es/>
- Pagina "Acerca de Procomun": <https://procomun.intef.es/es/contenido/acerca-de-procomun>
- Manual de Procomun: <https://descargas.intef.es/recursos_educativos/Manual_Procomun/index.html>
- Noticia INTEF "Procomun: nueva version actualizada y mejorada" (24/04/2023): <https://intef.es/Noticias/procomun-nueva-version-actualizada-y-mejorada/>
- Noticia INTEF "Actualizacion de la red de recursos educativos en abierto Procomun" (13/01/2022): <https://intef.es/Noticias/actualizacion-de-la-red-de-recursos-educativos-en-abierto-procomun/>
- Pagina INTEF "Ayuda en Procomun": <https://intef.es/formacion/te-ayudamos/ayuda-en-procomun/>

Limitaciones:

- Las funcionalidades privadas se extraen del manual publico; no se han validado con una cuenta real.
- Las funcionalidades administrativas se infieren solo cuando el manual o las noticias las mencionan.
- Algunas cifras son contadores visibles en portada en la fecha de consulta; deben tratarse como fotografia puntual, no como dato contractual.

## Problema educativo que cubre Procomun

Procomun funciona como espacio publico para localizar, consultar, descargar, publicar y reutilizar recursos educativos abiertos. Su propuesta combina repositorio REA, banco multimedia, creacion de contenidos, comunidades docentes y una capa de descubrimiento basada en metadatos educativos.

Usuario principal:

- Profesorado y comunidad docente que busca recursos reutilizables para el aula.

Usuarios secundarios:

- Alumnado y publico general que consulta o descarga objetos de aprendizaje.
- Autores de recursos educativos que publican y actualizan materiales.
- Administradores y curadores que validan publicaciones, comunidades y contenidos multimedia.
- Comunidades educativas que agrupan recursos y articulos sobre tematicas especificas.

## Volumetria visible en portada

| Elemento | Volumen visible | Observacion |
|----------|-----------------|-------------|
| Recursos de aprendizaje | 79.076 | Objetos digitales educativos para areas tematicas diversas |
| Itinerarios de aprendizaje | 389 | Secuencias didacticas con recursos y articulos |
| Banco multimedia | +100.000 | Fotografias, videos, audios e ilustraciones |
| Articulos | 23.563 | Publicaciones sobre temas de interes educativo |
| Comunidades | 55 | Grupos tematicos |
| Usuarios registrados | 110.523 | Personas registradas en Procomun |
| Boletines | 69 | Boletines publicados |

## Inventario de funcionalidades

### 1. Acceso publico, navegacion e idioma

- Acceso publico sin registro para buscar, consultar y descargar objetos de aprendizaje y elementos multimedia.
- Menu de idioma visible en portada: espanol, ingles, catalan, gallego y vasco.
- Acceso a ayuda, manual de uso, contacto, aviso legal, politica de privacidad, politica de cookies, accesibilidad y mapa del sitio.
- Home con bloques de acceso a recursos de aprendizaje, itinerarios, Banco Multimedia, articulos, comunidades, usuarios y boletines.
- Bloques de recursos destacados, novedades, ultimas comunidades y ultimos boletines.

### 2. Busqueda y descubrimiento

- Buscador principal presente en todas las paginas.
- Dos modos de busqueda visibles desde la home:
  - Busqueda de recursos.
  - Busqueda multimedia.
- Busqueda literal sobre recursos y elementos multimedia.
- Filtros iniciales para recursos:
  - Tipo de contenido.
  - Area de conocimiento.
  - Contexto educativo.
- Tipos principales de contenido en busqueda:
  - Todos los contenidos.
  - Recursos de aprendizaje.
  - Articulos.
  - Itinerarios de aprendizaje.
- Resultados paginados, con 10 resultados por pagina segun el manual.
- Ordenacion de resultados en funcion del tipo de busqueda.
- Filtros posteriores segun los resultados, incluyendo etiquetas presentes en la busqueda.
- Busqueda facetada y capa semantica sobre datos estructurados y enlazados, segun la descripcion institucional.
- Navegacion por etiquetas, areas de conocimiento y contextos educativos desde las fichas de contenido.

### 3. Recursos de aprendizaje

- Consulta publica de recursos de aprendizaje.
- Previsualizacion de recurso con:
  - Arbol de navegacion lateral.
  - Area central de visualizacion del contenido.
  - Posibilidad de ampliar la visualizacion.
- Barra de acciones asociada al recurso:
  - Numero de visitas.
  - "Me gusta" para usuarios autenticados.
  - Compartir en redes sociales.
  - Incrustacion mediante iframe.
  - Descarga en formatos SCORM 2004, SCORM 1.2, ePUB, IMS y HTML.
  - Edicion o eliminacion si el recurso pertenece al usuario autenticado.
  - Apertura con eXeLearning online cuando aplica.
- Visualizacion de metadatos debajo del recurso, con enlaces reutilizables como filtros de busqueda.
- Creacion de recursos por usuarios autenticados.
- Subida de archivos de multiples formatos.
- Regla documentada para editables: si se sube un archivo editable, debe acompanarse de PDF porque el editable solo se puede descargar, no visualizar.
- Formulario de publicacion con campos documentados:
  - Titulo.
  - Imagen en miniatura y texto alternativo.
  - Descripcion.
  - Etiquetas recomendadas.
  - Idioma.
  - Tipo de recurso.
  - Area de conocimiento.
  - Contexto educativo.
  - Destinatario y ambito de uso.
- Publicacion directa o guardado como borrador, segun permisos del usuario y flujo disponible.
- Edicion posterior del recurso propio desde la ficha o desde el perfil.

### 4. eXeLearning online

- Integracion de eXeLearning online en la plataforma.
- Edicion directa, desde Procomun, de recursos propios creados con eXeLearning.
- Mejora introducida para responder a la necesidad de modificar materiales tras su publicacion.
- Los recursos del repositorio tienen como nucleo historico contenidos en formato SCORM y materiales realizados con eXeLearning.

### 5. Banco Multimedia

- Banco Multimedia integrado en Procomun a partir del antiguo Banco de Imagenes y Sonidos del INTEF.
- Consulta publica de fotografias, videos, audios e ilustraciones.
- Busqueda especifica de elementos multimedia.
- Busqueda por palabra en titulo, descriptores o descripcion.
- Navegacion por pestanas de tipo de contenido multimedia.
- Filtros especificos segun el tipo de media.
- Colecciones multimedia como agrupaciones de elementos.
- Ficha de recurso multimedia con visualizacion y descarga.
- Descarga condicionada a la aceptacion de condiciones y al respeto de la licencia de cada recurso.
- Contribucion al Banco Multimedia desde el perfil privado de usuario.
- Subida mediante drag and drop o seleccion de archivos.
- Subida de 1 a 10 recursos en una misma operacion.
- Tipologias documentadas para contribucion:
  - Fotografias.
  - Videos.
  - Ilustraciones.
  - Audios.
- Subida multiple para fotografias, ilustraciones y audios; videos excluidos de la subida multiple segun el manual.
- Flujo de estados para contribuciones multimedia:
  - Borrador.
  - Pendiente de publicacion.
  - Publicado.
- Publicacion controlada por administracion: el usuario no puede publicar directamente en el Banco Multimedia sin aprobacion.
- Gestion de metadatos tras la subida.

### 6. Articulos

- Consulta publica de articulos educativos.
- Articulos orientados a compartir experiencias, buenas practicas docentes o reflexiones sobre REA de Procomun u otros espacios.
- Visualizacion con fotografia, descripcion, etiquetas, area de conocimiento, contexto educativo, visitas, "me gusta" y enlaces para compartir.
- Creacion de articulos por usuarios autenticados.
- Formulario documentado con:
  - Titulo.
  - Imagen en miniatura y texto alternativo.
  - Cuerpo del articulo.
  - Etiquetas.
  - Contexto educativo.
  - Area de conocimiento.
  - Datos de autor y otros autores.
  - Licencia.
  - Comunidades en las que se publica.
- Guardado como borrador o publicacion posterior.

### 7. Itinerarios de aprendizaje

- Consulta publica de itinerarios de aprendizaje.
- Itinerarios como secuencias didacticas para planificar sesiones de aula.
- Agrupacion ordenada de recursos educativos ya publicados en Procomun.
- Posibilidad documentada de incluir articulos en el itinerario.
- Visualizacion con titulo, fecha, creador, descripcion, etiquetas, area, contexto, visitas, "me gusta" y enlaces de comparticion.
- Listado de recursos del itinerario con detalle de cada elemento.
- Creacion de itinerarios por usuarios autenticados.
- Formulario documentado con:
  - Titulo.
  - Descripcion.
  - Area de conocimiento.
  - Contexto educativo.
  - Etiquetas.
  - Recursos del itinerario.
  - Articulos del itinerario.
  - Comunidad en la que se publica.
- Guardado como borrador y publicacion posterior.
- Clonado de itinerarios de otros usuarios para adaptarlos a necesidades propias, documentado en contenidos de ayuda de Procomun.

### 8. Comunidades

- Listado publico de comunidades.
- Comunidades como espacios donde los miembros generan, comparten y encuentran contenidos.
- Tipos de comunidad:
  - Publica: los usuarios pueden suscribirse y pasan automaticamente a formar parte de la comunidad.
  - Restringida: la suscripcion requiere aceptacion por parte de un administrador de la comunidad.
- Busqueda y filtrado de comunidades por:
  - Administradores.
  - Etiquetas asociadas.
  - Texto libre.
  - Fecha.
- Vista de comunidad con:
  - Tipo de comunidad.
  - Buscador interno.
  - Desplegable de tipos de recursos existentes en la comunidad.
  - Numero de elementos por tipo.
  - Contenidos publicados.
  - Numero de miembros.
  - Numero de recursos.
  - Relacion de miembros, administrador y participantes.
- Los usuarios autenticados pueden solicitar la creacion de comunidades publicas o restringidas.
- Creacion de comunidad sometida a aprobacion de administracion.
- Formulario de solicitud con titulo, descripcion, etiquetas y alias URL amigable.

### 9. Usuarios, registro y autenticacion

- Dos grandes tipos de usuario:
  - Publico o anonimo.
  - Privado o autenticado.
- Registro desde la parte superior de la plataforma.
- Alta mediante datos personales, campos obligatorios y correo de confirmacion.
- Inicio de sesion con correo electronico y contrasena.
- Listado publico de usuarios.
- Busqueda de usuarios por nombre.
- Ordenacion de usuarios alfabeticamente y por fecha.
- Perfil publico de usuario con:
  - Recursos creados.
  - Detalles publicos.
  - Numero de recursos subidos.
  - Comunidades a las que pertenece.
- Preferencias de visibilidad para decidir que datos personales se muestran publicamente.

### 10. Perfil privado y area personal

- Perfil privado para usuarios registrados.
- Pestaña de actividad con contenido publicado y filtros.
- Acceso a botones de creacion de nuevo contenido.
- Gestion de comunidades del usuario.
- Solicitud de nuevas comunidades desde "Mis comunidades".
- Gestion de favoritos: consulta y retirada de contenidos marcados como favoritos.
- Gestion de borradores: eliminar, editar y publicar contenidos guardados.
- Area multimedia para subir y consultar contribuciones al Banco Multimedia.
- Filtros por estado de las contribuciones multimedia.
- Gestion de datos personales y curriculum.
- Configuracion de visibilidad de campos publicos.
- Gestion de cuenta:
  - Nombre de usuario.
  - Contrasena.
  - Idioma del usuario.
  - Imagen de avatar.

### 11. Boletines y comunicacion editorial

- Consulta publica de boletines desde la portada.
- Listado de ultimos boletines.
- Vista de boletin individual.
- Suscripcion al boletin para usuarios autenticados.
- Suscripcion desde el bloque de boletines de la portada o durante la creacion de cuenta, en mensajes y notificaciones.

### 12. App movil

- Procomun enlaza aplicaciones para App Store y Google Play desde la portada y la pagina "Acerca de".
- La noticia de abril de 2023 indica que parte de las actualizaciones ya estaban disponibles en la app movil para Android e iOS.
- La misma noticia indica que la conexion del Banco Multimedia con la app estaba prevista proximamente; su estado funcional actual debe verificarse en pruebas de dispositivo o con documentacion interna.

### 13. Metadatos, estandares y reutilizacion

- Catalogacion estandarizada LOM-ES para material didactico.
- Recursos preparados para descarga y uso directo por profesorado y alumnado.
- Uso de areas de conocimiento, contexto educativo, tipo de recurso, idioma, etiquetas, destinatario y ambito de uso.
- Licencias asociadas a recursos, articulos y multimedia.
- Enlaces de metadatos como vias de refinamiento de busqueda.
- Soporte de paquetes SCORM y exportaciones en varios formatos para reutilizacion en entornos virtuales de aprendizaje.

### 14. Interaccion social y señales de uso

- "Me gusta" en recursos, articulos e itinerarios para usuarios autenticados.
- Favoritos en perfil privado.
- Numero de visitas visible en fichas de contenido.
- Comparticion en redes sociales.
- Participacion en comunidades.
- Publicacion de contenidos dentro de comunidades.

### 15. Administracion y moderacion documentadas

- Validacion administrativa de contribuciones al Banco Multimedia.
- Validacion administrativa de solicitudes de creacion de comunidades.
- Administradores de comunidad para aceptar solicitudes en comunidades restringidas.
- Edicion, aprobacion o publicacion de recursos multimedia pendientes por parte de administracion.
- Cambios internos de administracion mencionados por INTEF en la actualizacion de 2023, sin detalle publico suficiente para inventariar pantallas internas.

## Funcionalidades documentadas pero pendientes de verificacion en la version actual

Estas capacidades aparecen en contenidos de ayuda o articulos de Procomun, pero conviene validarlas con una cuenta real o con acceso interno antes de incluirlas como requisito cerrado:

- Contenidos externos mediante bookmarklet.
- Podcasts.
- Webinars.
- Permisos exactos de publicacion directa frente a solicitud de revision para cada tipo de contenido.
- Estado actual de la integracion del Banco Multimedia en la app movil.
- Capacidades completas de administracion, informes y moderacion interna.
- Estado real de edicion con eXeLearning online para recursos creados con diferentes versiones de eXeLearning.

## Punto de partida para procomun-ng

### Funcionalidades a conservar como minimo

- Catalogo publico de recursos educativos con busqueda, filtros y ficha detallada.
- Metadatos educativos ricos: area, contexto, idioma, tipo, etiquetas, licencia, autor y descripcion.
- Descarga y reutilizacion de recursos en formatos interoperables.
- Perfil de usuario con recursos publicados, borradores, favoritos y datos publicos configurables.
- Creacion de recursos, articulos e itinerarios por usuarios autenticados.
- Colecciones o itinerarios ordenados de recursos.
- Banco Multimedia o modelo equivalente para media reutilizable.
- Comunidades o mecanismo alternativo para agrupar contenidos y personas por tematica.
- Flujo de revision para media, comunidades y contenidos que requieran moderacion.
- Accesibilidad, multiidioma, legal, privacidad y ayuda publica.

### Funcionalidades a mejorar o redefinir

- Busqueda facetada: mantener la potencia de filtrado, pero con taxonomias mas gobernables y mejor relevancia.
- Banco Multimedia: decidir si sera entidad independiente o media reutilizable dentro del catalogo.
- Itinerarios: convertirlos en colecciones/secuencias editables, clonables y faciles de mantener.
- Comunidades: separar claramente grupo social, curacion editorial y coleccion tematica.
- Moderacion: formalizar estados, roles y responsabilidades editoriales.
- Metadatos: evitar campos libres sin control y mejorar completitud, calidad y normalizacion.
- App movil: decidir si se sustituye por web responsive/PWA o se mantiene app nativa.
- eXeLearning online: decidir si se integra, se enlaza o se sustituye por flujo de importacion/exportacion `.elpx`.

### Funcionalidades que requieren decision de producto

- Nivel de compatibilidad con SCORM, IMS, ePUB, HTML e iframe.
- Alcance de articulos editoriales: blog institucional, experiencias docentes o contenido catalogable.
- Necesidad de boletines dentro de la plataforma o integracion con servicio externo.
- Grado de red social: favoritos y "me gusta" basicos frente a seguimiento, comentarios, comunidades y actividad.
- Politica de publicacion: publicacion abierta, revision previa, publicador certificado o modelos mixtos.
- Migracion de datos historicos de usuarios, comunidades, articulos, itinerarios y Banco Multimedia.

## Siguiente paso recomendado

Usar este inventario como entrada para una matriz de decision con tres columnas: "replicar", "mejorar" y "descartar/sustituir". Esa matriz deberia cruzarse despues con:

- valor publico y educativo,
- uso real esperado,
- coste de migracion,
- riesgo de interoperabilidad,
- impacto en busqueda y metadatos,
- necesidades de moderacion y soporte.

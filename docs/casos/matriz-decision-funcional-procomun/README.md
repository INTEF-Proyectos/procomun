# Matriz de decision funcional Procomun -> procomun-ng

> Tipo: Caso de analisis y priorizacion sin implementacion
> Fecha de redaccion: 2026-05-22
> Objetivo: cruzar el inventario funcional de Procomun actual con el estado de `procomun-ng` y decidir que mantener, mejorar, implementar, descartar/sustituir o validar con usuario/INTEF para alimentar Fase 2.

## Fuentes

- `docs/casos/inventario-funcional-procomun-actual/README.md`
- `docs/casos/inventario-funcional-procomun-ng-actual/README.md`
- `docs/casos/contexto-procomun-legacy/README.md`
- `docs/casos/contexto-procomun-legacy/requisitos-funcionales.md`
- `docs/producto/roadmap.md`

## Criterios de decision

Decisiones usadas en la matriz:

- `mantener como esta`: la capacidad actual de `procomun-ng` cubre razonablemente el valor de producto para Fase 2; solo requiere mantenimiento ordinario.
- `mejorar antes de migrar`: existe base funcional, pero no es suficiente para cargar o sustituir Procomun legacy sin degradar descubrimiento, calidad editorial o reutilizacion.
- `implementar porque falta`: Procomun actual ofrece una capacidad que `procomun-ng` no tiene como modulo funcional.
- `descartar o sustituir`: no conviene replicar la capacidad legacy tal cual; debe eliminarse del alcance o resolverse con otro producto/servicio/patron.
- `validar con usuario/INTEF`: falta una decision de producto, politica editorial, dato de uso real o restriccion institucional antes de convertir la capacidad en requisito.

Prioridades:

- `P0`: bloquea la migracion o la aceptacion de Fase 2.
- `P1`: paridad funcional importante para el primer reemplazo publico.
- `P2`: mejora relevante, pero puede ir despues de una migracion controlada.
- `P3`: opcion a descartar, sustituir o posponer salvo mandato explicito.

## Lectura ejecutiva

La Fase 2 no deberia limitarse a "migrar datos". Antes de migrar en volumen hay que cerrar seis decisiones/capacidades:

1. Busqueda y facetas completas, con materia, nivel, conteos, ordenacion real y estrategia de relevancia.
2. Perfil de metadatos completo, con campos legacy normalizados y validacion editorial.
3. Estrategia de migracion, incluyendo ETL, mapeo, deduplicacion, trazabilidad y migracion selectiva vs completa.
4. Banco Multimedia, decidiendo si sera entidad independiente o vista especializada de `media_items`.
5. Itinerarios, diferenciandolos de colecciones simples con orden, narrativa didactica y clonacion.
6. Decision explicita sobre comunidades y articulos: replicar, sustituir por curacion editorial/CMS o excluir.

## Matriz de decision

| ID | Funcionalidad legacy | Estado en Procomun actual | Estado en procomun-ng | Decision | Prioridad | Accion para Fase 2 |
|----|----------------------|---------------------------|------------------------|----------|-----------|--------------------|
| F2-01 | Catalogo publico de recursos | Catalogo publico con recursos de aprendizaje, fichas, descargas y navegacion por metadatos. | Implementado con `/explorar`, ficha publica, descarga, preview `.elpx`, rating y favoritos. | `mantener como esta` | P0 | Mantener como base de Fase 2 y evitar cambios de modelo que rompan URLs, slugs o API publica. |
| F2-02 | Busqueda textual | Buscador principal presente en la plataforma, con busqueda de recursos y multimedia. | Implementada por `q` en catalogo publico; multimedia no tiene busqueda independiente. | `mejorar antes de migrar` | P0 | Formalizar busqueda como epic de Fase 2: texto, ordenacion, pesos, typo-tolerance si procede y criterio de relevancia documentado. |
| F2-03 | Facetas de recursos | Filtros por tipo, area de conocimiento, contexto educativo, etiquetas y refinamientos posteriores. | Facetas basicas por tipo, idioma y licencia; materias/niveles existen pero no estan plenamente integrados. | `mejorar antes de migrar` | P0 | Anadir materia, nivel/contexto, etiquetas, conteos por faceta y persistencia completa en URL/API. |
| F2-04 | Ordenacion de resultados | Resultados ordenables segun tipo de busqueda. | UI muestra opciones, pero el backend no recibe parametro de ordenacion segun inventario. | `mejorar antes de migrar` | P0 | Conectar `sort` en API/repositorio y definir valores soportados: relevancia, fecha, valoracion, descargas. |
| F2-05 | Metadatos educativos ricos | LOM-ES, area, contexto, destinatario, ambito, idioma, licencia, etiquetas, tipo y autor. | Perfil minimo implementado; hay campos opcionales de materias, niveles, accesibilidad, duracion, origen e importacion. | `mejorar antes de migrar` | P0 | Definir perfil de metadatos Fase 2 y cerrar mapeo legacy -> `procomun-ng`, incluyendo obligatoriedad y calidad minima. |
| F2-06 | Metadatos enlazables como filtros | Las fichas enlazan areas, contextos y etiquetas para refinar busqueda. | Ficha muestra materias, niveles y etiquetas; no todos estan integrados como facetas principales. | `mejorar antes de migrar` | P1 | Convertir metadatos visibles en enlaces de busqueda consistentes y trazables. |
| F2-07 | Migracion de recursos legacy | Procomun contiene cerca de 79k recursos y paquetes historicos. | Analisis legacy documentado; ETL/importacion real no implementada. | `implementar porque falta` | P0 | Crear epic de migracion con inventario de fuentes, mapeo, pruebas de muestra, deduplicacion, auditoria y rollback. |
| F2-08 | Migracion de usuarios | Procomun tiene mas de 100k usuarios registrados y perfiles publicos/privados. | Auth y roles existen; no hay estrategia de migracion de usuarios, identidad o consentimiento. | `validar con usuario/INTEF` | P0 | Decidir si se migran cuentas, perfiles publicos, autores historicos o solo atribuciones anonimizadas/normalizadas. |
| F2-09 | Migracion de ficheros y paquetes | Procomun descarga SCORM 2004, SCORM 1.2, ePUB, IMS, HTML y usa `.elpx`. | `.elpx` cubierto; formatos SCORM/IMS/ePUB/HTML no cerrados como compatibilidad de salida. | `validar con usuario/INTEF` | P0 | Definir formatos obligatorios de preservacion y exportacion antes de migrar paquetes. |
| F2-10 | eXeLearning online | Edicion online de recursos propios eXeLearning. | Integracion tecnica de editor, preview, subida, guardado y generacion `.elpx`. | `mantener como esta` | P1 | Mantener como capacidad diferencial y ampliar solo si las pruebas de recursos legacy detectan incompatibilidades. |
| F2-11 | Banco Multimedia como seccion publica | Banco independiente con fotos, videos, audios, ilustraciones, busqueda propia, filtros y fichas. | `media_items` existe como adjunto asociado a recursos; no hay producto Banco Multimedia. | `implementar porque falta` | P0 | Disenar MVP de Banco Multimedia: entidad publica, ficha, busqueda/facetas, descarga, licencia y reutilizacion desde recursos. |
| F2-12 | Modelo de producto del Banco Multimedia | Legacy funciona como subsistema con mas de 100k items y contribucion propia. | La base tecnica puede evolucionar desde `media_items`, pero el producto no esta decidido. | `validar con usuario/INTEF` | P0 | Decidir si sera entidad independiente, vista especializada del catalogo, o ambos; cerrar impacto en almacenamiento y moderacion. |
| F2-13 | Contribucion multimedia | Subida de 1 a 10 recursos, drag and drop, tipos media y gestion de metadatos. | Hay upload resumable multiarchivo asociado a recursos; no hay contribucion multimedia independiente. | `mejorar antes de migrar` | P1 | Separar flujo de subida de media reutilizable del flujo de adjuntos de recurso, con metadatos propios y estados editoriales. |
| F2-14 | Moderacion del Banco Multimedia | Publicacion controlada por administracion con estados borrador, pendiente y publicado. | Flujo editorial existe para recursos; media no tiene cola editorial independiente comparable. | `implementar porque falta` | P1 | Crear workflow editorial de media o extender el workflow actual a entidades no recurso. |
| F2-15 | Itinerarios de aprendizaje | Secuencias didacticas ordenadas con recursos y articulos, clonables por usuarios. | Colecciones publicas y ordenadas existen; no hay experiencia especifica de itinerario. | `implementar porque falta` | P1 | Crear subtipo/experiencia de itinerario: pasos, objetivos, duracion, recursos ordenados, articulos vinculables y clonacion. |
| F2-16 | Colecciones | Procomun tiene colecciones/agrupaciones con problemas legacy de acoplamiento a metadatos. | Colecciones implementadas como entidad independiente con asociacion directa y orden editorial. | `mantener como esta` | P1 | Mantener el modelo actual como mejora frente a legacy y usarlo como base tecnica de itinerarios. |
| F2-17 | Articulos educativos | Publicacion de experiencias, buenas practicas y reflexiones; pueden integrarse en itinerarios y comunidades. | No existen como modulo propio. | `validar con usuario/INTEF` | P1 | Decidir si los articulos son contenido catalogable dentro de `procomun-ng`, un CMS externo, o quedan fuera de Fase 2. |
| F2-18 | Comunidades | Comunidades publicas/restringidas con miembros, administradores, contenidos y solicitudes de creacion. | No existen comunidades; solo social ligero y colecciones. | `validar con usuario/INTEF` | P1 | Decidir si se replican comunidades o se sustituyen por colecciones curatoriales, perfiles de autor y canales externos. |
| F2-19 | Publicacion dentro de comunidades | Contenidos asociados a comunidades y administracion de solicitudes. | No existe destino de publicacion por comunidad. | `descartar o sustituir` | P2 | No implementar hasta decidir F2-18; si se descartan comunidades, sustituir por taxonomias, colecciones editoriales o paginas tematicas. |
| F2-20 | Boletines | Listado publico, boletin individual y suscripcion. | No existe modulo de boletines. | `descartar o sustituir` | P3 | Resolver con servicio externo de comunicacion institucional salvo que INTEF pida archivo publico dentro de la plataforma. |
| F2-21 | App movil | Procomun enlaza apps iOS/Android y tenia integraciones previstas con Banco Multimedia. | No existe app movil; frontend es web responsive. | `descartar o sustituir` | P3 | Sustituir por responsive/PWA en roadmap salvo mandato contractual o analitica de uso que justifique app nativa. |
| F2-22 | Perfil personal | Area privada con recursos, borradores, favoritos, comunidades, multimedia, datos y curriculum. | Perfil con recursos, favoritos, valoraciones y actividad; bio/visibilidad parcial. | `mejorar antes de migrar` | P1 | Completar perfil: bio persistente, visibilidad publica, borradores, media propia y preferencias de privacidad. |
| F2-23 | Perfil publico y listado de usuarios | Listado publico, busqueda de usuarios, recursos creados y comunidades. | No se identifica listado publico completo de usuarios; perfil esta centrado en area personal. | `validar con usuario/INTEF` | P2 | Validar necesidad y riesgos RGPD antes de publicar directorio de usuarios o perfiles ricos. |
| F2-24 | Registro publico | Alta con datos personales y confirmacion de correo. | Ruta `/registro` existe, pero el formulario parece llamar a `signIn`; requiere correccion/verificacion. | `mejorar antes de migrar` | P0 | Corregir o cerrar el flujo de registro antes de pruebas con autores externos. |
| F2-25 | Roles y permisos | Usuarios anonimos, autenticados, administradores y administradores de comunidad. | RBAC con `reader`, `author`, `editor`, `curator`, `admin`. | `mantener como esta` | P0 | Mantener jerarquia actual; revisar solo permisos nuevos de media, itinerarios y comunidades si se aprueban. |
| F2-26 | Flujo editorial de recursos | Publicacion/borrador segun permisos y administracion parcial documentada. | Estados y transiciones formales por rol ya implementadas. | `mantener como esta` | P0 | Usar como patron comun para nuevas entidades; no bloquear Fase 2 salvo nuevos estados de calidad. |
| F2-27 | Moderacion avanzada | Validacion de multimedia y comunidades; administracion interna no inventariada en detalle. | Flujo de recursos existe; no hay denuncias, revision campo a campo, motivos de rechazo ni colas avanzadas. | `mejorar antes de migrar` | P1 | Definir cola editorial, motivos, comentarios internos, auditoria y criterios de calidad antes de abrir migracion/publicacion masiva. |
| F2-28 | Backoffice editorial | Administracion documentada parcialmente; cambios internos poco visibles. | Backoffice MVP para recursos, colecciones, taxonomias, usuarios y badges. | `mejorar antes de migrar` | P1 | Convertir backoffice de CRUD a herramienta editorial: colas, filtros por calidad, informes y acciones masivas. |
| F2-29 | Favoritos, me gusta, rating y descargas | Me gusta, favoritos, visitas y comparticion social. | Favoritos, ratings, descargas y actividad personal implementados; comentarios no conectados. | `mantener como esta` | P2 | Mantener social ligero como senal de relevancia; no ampliar sin decision explicita. |
| F2-30 | Comentarios y participacion social | Participacion en comunidades; comentarios no quedan confirmados como capacidad central del inventario. | Referencias historicas, pero sin API/esquema operativo observado. | `validar con usuario/INTEF` | P2 | Decidir si comentarios aportan valor docente o incrementan coste de moderacion sin retorno claro. |
| F2-31 | Comparticion e iframe | Compartir en redes, iframe e incrustacion. | Copiar enlace e iframe para preview `.elpx`. | `mejorar antes de migrar` | P2 | Validar embed estable, permisos, CSP y formatos soportados para recursos migrados. |
| F2-32 | Multiidioma | Espanol, ingles, catalan, gallego y vasco. | Rutas localizadas `es`, `en`, `ca`, `gl`, `eu`. | `mantener como esta` | P1 | Mantener cobertura; revisar traducciones reales antes de salida publica. |
| F2-33 | Ayuda, legal, privacidad y accesibilidad | Manual, ayuda, contacto, legal, privacidad, cookies, accesibilidad y mapa. | Pagina de ayuda; layout accesible; no se inventaria suite legal completa. | `mejorar antes de migrar` | P1 | Completar paginas legales, accesibilidad, cookies y mapa del sitio con revision institucional. |
| F2-34 | API publica versionada | Procomun ofrece consumo publico y elementos interoperables documentados parcialmente. | API `/api/v1` para recursos, taxonomias, colecciones, social, stats y `.elpx`. | `mantener como esta` | P1 | Mantener versionado y documentar contrato antes de integraciones externas. |
| F2-35 | OAI-PMH y cosecha/interoperabilidad | Legacy vinculado a Agrega/LOM y requisitos OAI/interop en documentacion. | OAI-PMH cliente/servidor y exportacion bulk no implementados. | `implementar porque falta` | P2 | Planificar despues del nucleo de migracion: OAI-PMH, exportacion bulk y mapeo LOM/DC. |
| F2-36 | Recomendaciones | No aparece como capacidad central del inventario actual publico. | No implementado. | `descartar o sustituir` | P3 | Posponer hasta tener busqueda, metadatos y analitica de uso fiables. |
| F2-37 | Analitica e informes | Procomun muestra contadores y menciona informes administrativos del Banco Multimedia en legacy. | Contadores sociales y stats basicas; analitica de uso/calidad no implementada. | `implementar porque falta` | P2 | Definir KPIs de busqueda, calidad de metadatos, uso de recursos y salud editorial. |

## Prioridades recomendadas para Fase 2

### P0 - Bloqueantes antes de migrar en volumen

1. **Busqueda/facetas completas**: extender filtros a materia, nivel/contexto y etiquetas; anadir conteos, ordenacion real y criterio de relevancia.
2. **Metadatos completos**: cerrar perfil Fase 2, mapeo LOM-ES/legacy, validacion editorial y obligatoriedad por tipo de recurso.
3. **Migracion**: construir ETL con trazabilidad, importacion piloto, deduplicacion, migracion de ficheros y estrategia de rollback.
4. **Banco Multimedia**: decidir modelo de producto y datos antes de migrar los mas de 100k elementos multimedia.
5. **Registro/autoria**: corregir alta publica y decidir migracion de usuarios/autores historicos.

### P1 - Paridad funcional de reemplazo publico

1. **Banco Multimedia MVP**: busqueda, ficha, descarga, licencia, contribucion y moderacion.
2. **Itinerarios**: experiencia propia sobre colecciones ordenadas, con clonacion y estructura didactica.
3. **Moderacion y backoffice editorial**: colas, motivos, revision de calidad, informes y acciones masivas.
4. **Perfil y privacidad**: perfil publico/privado coherente, visibilidad configurable y actividad del autor.
5. **Decision comunidades/articulos**: cerrar si se implementan, se sustituyen o se excluyen.

### P2 - Apertura e interoperabilidad

1. OAI-PMH, exportacion bulk y documentacion de API publica.
2. Analitica de uso, calidad de metadatos y efectividad de busqueda.
3. Embed/iframe robusto y compatibilidad de formatos externos.
4. Decision sobre comentarios y participacion social ampliada.

### P3 - Sustituciones recomendadas salvo mandato

1. Boletines dentro de plataforma: preferible servicio externo institucional.
2. App movil nativa: preferible web responsive/PWA salvo evidencia o requisito contractual.
3. Recomendaciones automaticas: posponer hasta que busqueda, metadatos y analitica sean fiables.

## Decisiones que requieren validacion con usuario/INTEF

Antes de convertir la matriz en tareas de implementacion, conviene resolver estos puntos:

1. La migracion debe ser completa o selectiva por calidad/uso/licencia.
2. Se migran usuarios reales, solo autores historicos, o se preserva atribucion sin cuenta activa.
3. Banco Multimedia debe ser producto independiente visible en navegacion principal.
4. Articulos son parte del repositorio, contenido editorial externo o una capacidad a retirar.
5. Comunidades siguen siendo necesarias o se sustituyen por colecciones, taxonomias y curacion editorial.
6. Que formatos legacy son obligatorios: SCORM 1.2, SCORM 2004, IMS, ePUB, HTML y/o `.elpx`.
7. La app movil debe mantenerse como requisito o queda sustituida por web responsive/PWA.

## Salida esperada para roadmap

La Fase 2 deberia reorganizarse alrededor de estas epicas:

| Orden | Epica Fase 2 propuesta | Origen en matriz | Resultado esperado |
|-------|------------------------|------------------|--------------------|
| 1 | Busqueda, facetas y relevancia Fase 2 | F2-02, F2-03, F2-04, F2-06 | Busqueda comparable o superior a Procomun actual antes de migrar catalogo completo. |
| 2 | Perfil de metadatos y calidad editorial | F2-05, F2-06, F2-27, F2-28 | Recursos migrados con metadatos completos, validables y gobernables. |
| 3 | Migracion legacy Procomun | F2-07, F2-08, F2-09 | ETL probado, trazable y reversible para recursos, ficheros y autoria. |
| 4 | Banco Multimedia | F2-11, F2-12, F2-13, F2-14 | Decision de producto y MVP operativo para media reutilizable. |
| 5 | Itinerarios y colecciones didacticas | F2-15, F2-16 | Itinerarios diferenciados, clonables y reutilizables por docentes. |
| 6 | Comunidades, articulos y comunicacion editorial | F2-17, F2-18, F2-19, F2-20 | Decision documentada: implementar, sustituir con CMS/canales externos o excluir. |

## Riesgos abiertos

- Migrar datos sin cerrar metadatos y busqueda puede degradar el descubrimiento aunque el volumen de catalogo aumente.
- Replicar comunidades y articulos sin evidencia de uso puede trasladar complejidad social y moderacion sin mejorar reutilizacion.
- Convertir Banco Multimedia en "adjuntos de recursos" perderia valor publico si INTEF espera un banco reutilizable independiente.
- Mantener formatos legacy sin priorizacion puede consumir Fase 2 en compatibilidad tecnica y no en calidad pedagogica.
- Migrar usuarios reales exige decision de privacidad, consentimiento, identidad y comunicacion institucional.

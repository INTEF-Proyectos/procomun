# Ejecucion de pruebas manuales - 2026-05-22

> Plan asociado: `docs/casos/plan-pruebas-manuales-procomun-ng/README.md`
> Plantilla asociada: `docs/casos/plan-pruebas-manuales-procomun-ng/plantilla-ejecucion.md`

## Datos de la prueba

| Campo | Valor |
|-------|-------|
| ID de ejecucion | `MANUAL-2026-05-22-01` |
| Fecha inicio | `2026-05-22 17:12` |
| Fecha fin | Pendiente |
| Responsable QA | Juanda |
| Rama | `main` |
| Commit probado | `3928363996ed78f1f68d47253492cf05167a9f0f` |
| Entorno | Local |
| URL frontend | `http://localhost:5173` |
| URL API | `http://localhost:3000` |
| Base de datos | PGlite |
| Seed ejecutado | Si |
| Comando de arranque | `make up` |
| Navegador principal | Chrome |
| Viewports probados | Desktop |
| Preparacion del entorno | OK |
| Resultado global | Pendiente |
| Observaciones generales | Pruebas en curso. Ya hay defectos detectados en ficha de recurso y permisos de acceso a `/admin`. |

Estados recomendados para los casos: `OK`, `Fallo`, `Pendiente`, `Bloqueado`, `No aplica`.

## Matriz de ejecucion por caso

| Caso | Area | Rol principal | Navegador/viewport | Estado | Defecto | Notas |
|------|------|---------------|--------------------|--------|---------|-------|
| MP-01 | Smoke tecnico del entorno | Anonimo | Chrome / Desktop | OK |  |  |
| MP-02 | Navegacion publica e idioma | Anonimo | Chrome / Desktop | OK |  |  |
| MP-03 | Home y descubrimiento inicial | Anonimo | Chrome / Desktop | OK |  |  |
| MP-04 | Catalogo publico | Anonimo / Reader | Chrome / Desktop | OK |  |  |
| MP-05 | Ficha publica de recurso | Anonimo / Reader | Chrome / Desktop | Fallo | DEF-003 | El contador de descargas no se incrementa. |
| MP-06 | Login, logout y sesion | Reader / Author | Chrome / Desktop | Fallo | DEF-004 | Reader, author o editor pueden acceder a `/admin`. |
| MP-07 | Registro publico | Anonimo | Chrome / Desktop | Fallo |  |  |
| MP-08 | Perfil personal y social ligero | Author / Reader | Chrome / Desktop | OK |  |  |
| MP-09 | Creacion de recurso manual | Author | Chrome / Desktop | OK |  |  |
| MP-10 | Flujo editorial por rol | Author / Editor / Curator / Admin | Chrome / Desktop | Fallo |  |  |
| MP-11 | Uploads y adjuntos | Author / Curator | Chrome / Desktop | Fallo |  |  |
| MP-12 | eXeLearning y `.elpx` | Author / Curator | Chrome / Desktop | Fallo |  |  |
| MP-13 | Colecciones publicas | Anonimo | Chrome / Desktop | OK |  |  |
| MP-14 | Backoffice: acceso y dashboard | Curator / Admin | Chrome / Desktop | Fallo |  |  |
| MP-15 | Backoffice: recursos | Curator / Admin | Chrome / Desktop | Pendiente | OK, para role admin |  |
| MP-16 | Backoffice: colecciones | Curator / Admin | Chrome / Desktop | Ok para role admin |  |  |
| MP-17 | Backoffice: taxonomias | Curator / Admin | Chrome / Desktop | Fallo |  |  |
| MP-18 | Backoffice: usuarios | Admin | Chrome / Desktop | Pendiente |  |  |
| MP-19 | Permisos y seguridad funcional | Varios | Chrome / Desktop | Pendiente |  |  |
| MP-20 | API smoke manual | Anonimo / Auth | Chrome / Desktop | Pendiente |  |  |

## Defectos encontrados

| ID defecto | Severidad | Caso | Titulo | Pasos de reproduccion | Resultado esperado | Resultado obtenido | Estado / notas |
|------------|-----------|------|--------|-----------------------|--------------------|--------------------|----------------|
| DEF-001 | S4 | Todos | Error intermitente en consola | Navegar por la aplicacion durante la ejecucion manual. | No aparecen errores no controlados en consola. | Aparece intermitentemente: `Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received`. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/152> |
| DEF-002 | S4 | Todos | Warning de sandbox en iframe | Navegar por pantallas con iframes o previews. | No aparecen warnings de seguridad relevantes en consola. | Aparece intermitentemente: `An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.` | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/153> |
| DEF-003 | S2 | MP-05 | El contador de descargas no funciona | Descargar un recurso desde la ficha publica. | Se incrementa el contador de descargas. | No se incrementa el contador. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/154> |
| DEF-004 | S1 | MP-06 | Reader, author o editor pueden entrar en `/admin` | Hacer login como reader, author o editor y navegar a `/admin`. | No se debe entrar en el panel de administracion. | Se entra en el panel de administracion. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/155> |
| DEF-005 | S1 | MP-07 | No se puede crear cuenta | Introducir datos validos para registro y hacer clic en crear cuenta. | Se debe crear la cuenta y redirigir a perfil. | Siempre aparece el mensaje de error `invalid email or password`. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/156> |
| DEF-006 | S2 | MP-10| El editor no puede crear recursos manualmente | Entrar como editor, clic en botón publicar o crear recurso, clic en Crear recurso manualmente, subir un pdf| Que se suba exitósamente el pdf | Arroja el error tus: unexpected response while creating upload, originated from request (method: POST, url: /api/uploads, response code: 403, response text: Permisos insuficientes, request id: n/a)| GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/157> |
| DEF-007 | S2 | MP-10 | el curator no ve los recursos que están en revisión en el panel de administración | Entrar como autor, crear un recurso y ponerlo en estado revisión y salir. Entrar como curator, ir a Administrar | el dashboard debe mostrar el nº de recursos a revisar distinto de cero | El contador es cero, también, si se va a listado de recursos y se seleciona recursos en revisión no aparece ninguno. Nota: el admin si puede realizar el flujo de revisión completo, sí ve los recursos en revisión, los puede revisar y archivar| GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/158> |
| DEF-008 | S2 | MP-11 | Al eliminar recursos siguen apareciendo en la previsualización | Entrar como autor, crear nuevo recurso manualmente, subir varios ficheros crear el recurso y, después, eliminar uno | Debería desaparecer de la previsualización | no desaparece de la previsualización sin recargar página, si se recarga la página, sí desaparece| GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/159> |
| DEF-009 | S2 | MP-12 | Al subir un elpx, no se precargan campos (no sé si se analizan)| Entra como perfil superior o igual a autor, crear nuevo recurso, subir elpx| Se debería precargar los campos| No se precargan los campos. Nota: el botón Aplicar metadatos del .epx sí funciona|  GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/160> |
| DEF-010 | S2 | MP-14 | Todas las tarjetas de estadísticas están a 0 | Entrar como curator, entrar en panel de administración | Las tarjetas deberían ser coherentes con el seed de prueba | Las tarjetas muestran todas cero | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/161> |
| DEF-011 | S2 | MP-14 | Como curator, la lista de recursos y de colecciones está vacía | Entar como curator, acceder al panel de administración y hacer clic en Recursos y Colecciones | Deberían mostrarse recursos y colecciones | No se muestran ningún recurso ni colecciones Nota: como admin si funciona bien| GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/162> |
| DEF-012 | S2 | MP-17 | Se duplican las taxonomias| Entrar como admin ir a panel de administración entrar en Categorias, crear una categoría con nombre duplicado | No se debe crear | Sí se crea | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/163> |
| DEF-013 | S2 | MP-17 | No se puede asociar a categoría padre| Entrar como admin ir a panel de administración entrar en Categorias, crear una categoría , añadir ID del padre (opcional) | Se debería asociar a un ID padre (uso el slug como ID o el nombre, pues no sé cómo obtener la ID, a lo mejor el problema es ese) | No se pudo crear la taxonomia.| GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/164> |


Severidades:

- `S1 bloqueante`: impide login, carga principal, publicacion, datos o backoffice.
- `S2 alta`: rompe un flujo principal pero existe alternativa.
- `S3 media`: error funcional acotado, inconsistencia de permisos, validacion o persistencia.
- `S4 baja`: texto, estilo, accesibilidad menor o mejora UX.

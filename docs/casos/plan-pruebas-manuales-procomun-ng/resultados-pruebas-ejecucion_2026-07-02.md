# Plantilla de ejecucion de pruebas manuales

> Plan asociado: `docs/casos/plan-pruebas-manuales-procomun-ng/README.md`
> Uso: duplicar este archivo para cada ronda de pruebas y rellenar solo lo ejecutado.

## Datos de la prueba

| Campo                   | Valor                                        |
| ----------------------- | -------------------------------------------- |
| ID de ejecucion         | `MANUAL-2026-07-02 19:15`                  |
| Fecha inicio            | `2026-07-02 19:15`                         |
| Fecha fin               | `pendiente`                                |
| Responsable QA          | PedroMolero                                  |
| Rama                    | `main`                                     |
| Commit probado          | `f66bf90b2f4f7e4611bf8179d235ce87c3fb69fa` |
| Entorno                 | Local                                        |
| URL frontend            | `http://localhost:5173`                    |
| URL API                 | `http://localhost:3000`                    |
| Base de datos           | PGlite                                       |
| Seed ejecutado          | Si                                           |
| Comando de arranque     | `make up` / otro                           |
| Navegador principal     | edge                                         |
| Viewports probados      | Desktop                                      |
| Preparacion del entorno | OK                                           |
| Resultado global        | Pendiente                                    |
| Observaciones generales |                                              |

Estados recomendados para los casos: `OK`, `Fallo`, `Pendiente`, `Bloqueado`, `No aplica`.

## Matriz de ejecucion por caso

| Caso  | Area                            | Rol principal                     | Navegador/viewport | Estado     | Defecto | Notas |
| ----- | ------------------------------- | --------------------------------- | ------------------ | ---------- | ------- | ----- |
| MP-01 | Smoke tecnico del entorno       | Anonimo                           |                    | Finalizado |         |       |
| MP-02 | Navegacion publica e idioma     | Anonimo                           |                    | Finalizado |         |       |
| MP-03 | Home y descubrimiento inicial   | Anonimo                           |                    | Finalizado |         |       |
| MP-04 | Catalogo publico                | Anonimo / Reader                  |                    | Finalizado |         |       |
| MP-05 | Ficha publica de recurso        | Anonimo / Reader                  |                    | Finalizado |         |       |
| MP-06 | Login, logout y sesion          | Reader / Author                   |                    | Finalizado |         |       |
| MP-07 | Registro publico                | Anonimo                           |                    | Finalizado |         |       |
| MP-08 | Perfil personal y social ligero | Author / Reader                   |                    | Finalizado |         |       |
| MP-09 | Creacion de recurso manual      | Author                            |                    | Finalizado |         |       |
| MP-10 | Flujo editorial por rol         | Author / Editor / Curator / Admin |                    | Finalizado |         |       |
| MP-11 | Uploads y adjuntos              | Author / Curator                  |                    | Finalizado |         |       |
| MP-12 | eXeLearning y`.elpx`          | Author / Curator                  |                    | Finalizado |         |       |
| MP-13 | Colecciones publicas            | Anonimo                           |                    | Finalizado |         |       |
| MP-14 | Backoffice: acceso y dashboard  | Curator / Admin                   |                    | Finalizado |         |       |
| MP-15 | Backoffice: recursos            | Curator / Admin                   |                    | Finalizado |         |       |
| MP-16 | Backoffice: colecciones         | Curator / Admin                   |                    | Finalizado |         |       |
| MP-17 | Backoffice: taxonomias          | Curator / Admin                   |                    | Finalizado |         |       |
| MP-18 | Backoffice: usuarios            | Admin                             |                    | Finalizado |         |       |
| MP-19 | Permisos y seguridad funcional  | Varios                            |                    | Finalizado |         |       |
| MP-20 | API smoke manual                | Anonimo / Auth                    |                    | Finalizado |         |       |

## Defectos encontrados

| ID defecto | Severidad   | Caso  | Titulo                                                                                                       | Pasos de reproduccion                                                                                                                                                                                                                                   | Resultado esperado | Resultado obtenido | Estado / notas |
| ---------- | ----------- | ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------ | -------------- |
| DEF-001    | S1/S2/S3/S4 | MP-02 | Abrir`/buscar`.                                                                                            | /buscar redirige a /buscar/explorar y no simplemente a /explorar<br />aunque ambas direcciones son iguales                                                                                                                                              |                    |                    | Nuevo          |
| DEF-002    | S1/S2/S3/S4 | MP-04 | Limpiar filtros                                                                                              | Cuando se aplica "Limpiar filtros" hay momentos en los que se bloquea el acceso a recurso y muestra sin resultados, se requiere para servicio y volverlo a levantar. También se observa parpadeo con presentación intermedia de búsqueda de recurso. |                    |                    | Nuevo          |
| DEF-003    | S1/S2/S3/S4 | MP-06 | Intentar`/admin` como anonimo.<br />Intentar`/admin` como reader/author/editor.                          | Redirige a login pero pasando por "Panel de Gestión" (Administrar de Admin) de forma momentanea cuando se hace /admin desde anónimo.                                                                                                                 |                    |                    | Nuevo          |
| DEF-004    | S1/S2/S3/S4 | MP-08 | Editar nombre y bio.                                                                                         | No permite crear nuevo usuario con mismo nombre desde registro. Sin embargo puedo editar mi nombre haciéndolo coincidir con otro dado de alta anteriormente, lo permite.                                                                               |                    |                    | Nuevo          |
| DEF-005    | S1/S2/S3/S4 | MP-10 | Curator/Archivar recurso publicado.                                                                          | Desde el perfil curator no se puede actuar sobre recursos publicados                                                                                                                                                                                    |                    |                    |                |
| DEF-006    | S1/S2/S3/S4 | MP-10 | Curator/Restaurar archivado a borrador.                                                                      | Desde el perfil curator no se puede actuar sobre recursos archivados                                                                                                                                                                                    |                    |                    | Nuevo          |
| DEF-007    | S1/S2/S3/S4 | MP-11 | Recargar editor.                                                                                             | Al recargar editor desaparece información sobre la cola de subida. Quizás se podría valorar si es necesario que aparezca tras la subida de ficheros.                                                                                                 |                    |                    | Nuevo          |
| DEF-008    | S1/S2/S3/S4 | MP-11 | Publicar recurso con adjunto y abrir ficha anonima.                                                          | Se añaden tres ficheros al recurso. Cuando se abre la ficha de publicación aparace el botón decargar y cuando se pulsa solamente baja el primer fichero de la lista. Falla                                                                           |                    |                    | Nuevo          |
| DEF-009    | S1/S2/S3/S4 | MP-14 |                                                                                                              | Desde la pantalla de administración aparece enlace a "ayuda" en la lista lateral de accesos, al final, el cual enlaza con el control superior. Se puede eliminar dado que aparece en la parte superior                                                 |                    |                    | Nuevo          |
| DEF-010    | S1/S2/S3/S4 | MP-16 | Anadir recurso a coleccion.                                                                                  | Cuando editas una colección si buscas recursos con campo vacío solamente lista 8 recursos.<br /><br />Cuando se añade un recurso desde la búsqueda no se elimina del listado de resultados.                                                         |                    |                    | Nuevo          |
| DEF-011    | S1/S2/S3/S4 | MP-19 | Como anonimo, llamar rutas privadas desde navegador:`/perfil`, `/nuevo`, `/editar?id=...`, `/admin`. | Da pantallazo intentando entrar de forma momentanea, después pasa correctamente a pantalla de identificación.                                                                                                                                         |                    |                    | Nuevo          |
| DEF-012    | S1/S2/S3/S4 | MP-19 | Como author, intentar abrir`/admin`.                                                                       | Pega pantallazo intentando entrar en Panel de Gestión. Al instante vuelve a pasar a perfil                                                                                                                                                             |                    |                    | Nuevo          |
| DEF-013    | S1/S2/S3/S4 | MP-19 | Como editor, intentar abrir`/admin`.                                                                       | Pega pantallazo intentando entrar en Panel de Gestión. Al instante vuelve a pasar a perfil                                                                                                                                                             |                    |                    | Nuevo          |

Severidades:

- `S1 bloqueante`: impide login, carga principal, publicacion, datos o backoffice.
- `S2 alta`: rompe un flujo principal pero existe alternativa.
- `S3 media`: error funcional acotado, inconsistencia de permisos, validacion o persistencia.
- `S4 baja`: texto, estilo, accesibilidad menor o mejora UX.

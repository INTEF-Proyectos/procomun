# Plantilla de ejecucion de pruebas manuales

> Plan asociado: `docs/casos/plan-pruebas-manuales-procomun-ng/README.md`
> Uso: duplicar este archivo para cada ronda de pruebas y rellenar solo lo ejecutado.

## Datos de la prueba

| Campo | Valor |
|-------|-------|
| ID de ejecucion | `MANUAL-2026-05-26 14` |
| Fecha inicio | `2026-05-26 14:15a` |
| Fecha fin | `pendiente` |
| Responsable QA | PedroMolero |
| Rama |`main` |
| Commit probado |`96b021b6c58d5306e85b968bb727431515a37aa3`|
| Entorno | Local |
| URL frontend | `http://localhost:5173` |
| URL API | `http://localhost:3000` |
| Base de datos | PGlite |
| Seed ejecutado | Si |
| Comando de arranque | `make up` / otro |
| Navegador principal | edge |
| Viewports probados | Desktop |
| Preparacion del entorno | OK |
| Resultado global | Pendiente |
| Observaciones generales |  |

Estados recomendados para los casos: `OK`, `Fallo`, `Pendiente`, `Bloqueado`, `No aplica`.

## Matriz de ejecucion por caso

| Caso | Area | Rol principal | Navegador/viewport | Estado | Defecto | Notas |
|------|------|---------------|--------------------|--------|---------|-------|
| MP-01 | Smoke tecnico del entorno | Anonimo |  | Finalizado |  |  |
| MP-02 | Navegacion publica e idioma | Anonimo |  | Finalizado |  |  |
| MP-03 | Home y descubrimiento inicial | Anonimo |  | Finalizado |  |  |
| MP-04 | Catalogo publico | Anonimo / Reader |  | Finalizado |  |  |
| MP-05 | Ficha publica de recurso | Anonimo / Reader |  | Finalizado |  |  |
| MP-06 | Login, logout y sesion | Reader / Author |  | Finalizado |  |  |
| MP-07 | Registro publico | Anonimo |  | Finalizado |  |  |
| MP-08 | Perfil personal y social ligero | Author / Reader |  | Finalizado |  |  |
| MP-09 | Creacion de recurso manual | Author |  | Finalizado |  |  |
| MP-10 | Flujo editorial por rol | Author / Editor / Curator / Admin |  | Finalizado |  |  |
| MP-11 | Uploads y adjuntos | Author / Curator |  | Finalizado |  |  |
| MP-12 | eXeLearning y `.elpx` | Author / Curator |  | Finalizado |  |  |
| MP-13 | Colecciones publicas | Anonimo |  | Finalizado |  |  |
| MP-14 | Backoffice: acceso y dashboard | Curator / Admin |  | Finalizado |  |  |
| MP-15 | Backoffice: recursos | Curator / Admin |  | Finalizado |  |  |
| MP-16 | Backoffice: colecciones | Curator / Admin |  | Finalizado |  |  |
| MP-17 | Backoffice: taxonomias | Curator / Admin |  | Finalizado |  |  |
| MP-18 | Backoffice: usuarios | Admin |  | Finalizado |  |  |
| MP-19 | Permisos y seguridad funcional | Varios |  | Finalizado |  |  |
| MP-20 | API smoke manual | Anonimo / Auth |  | Finalizado |  |  |

## Defectos encontrados

| ID defecto | Severidad | Caso | Titulo | Pasos de reproduccion | Resultado esperado | Resultado obtenido | Estado / notas |
|------------|-----------|------|--------|-----------------------|--------------------|--------------------|----------------|
| DEF-001 | S1/S2/S3/S4 | MP-04 |Limpiar busqueda  | La limpieza se tiene que efectuar con el botón LIMPIAR FILTROS, no tiene botón propio para limpiar búsqueda |  |  | Nuevo |
| DEF-002 | S1/S2/S3/S4 | MP-05 |  Abrir recurso no publicado como anonimo si se conoce URL.| Desde la ventana de administración no se dispone de url asignada al recurso independientemente de su estado: publicado, borrador, en revisión  |  |  | Nuevo |
| DEF-003 | S1/S2/S3/S4 | MP-07 | Enviar email nuevo y password valido. | No solicita verificación de acceso a la cuenta de email de alta |  |  | Nuevo |
Severidades:
| DEF-004 | S1/S2/S3/S4 | MP-08 | Editar nombre y bio. | No guarda cambios sobre "nombre" y "sobre mí". |  |  | Nuevo |
| DEF-005 | S1/S2/S3/S4 | MP-08 | Marcar favorito desde catalogo/ficha y volver a perfil. | No funciona el contador de favoritos del recurso hasta seleccionar/deseleccionar |  |  | Nuevo |
| DEF-006 | S1/S2/S3/S4 | MP-09 | Elegir Crear recurso manualmente. | No funciona, no dirige a nueva pantalla desde perfil AUTHOR pero sí desde ADMIN |  |  | Nuevo |
| DEF-007 | S1/S2/S3/S4 | MP-10 | Intentar publicar directamente. | No se ha podido probar por no haber creado el recurso de AUTHOR |  |  | Nuevo |
| DEF-008 | S1/S2/S3/S4 | MP-10 | Crear recurso manual y pulsar Publicar directamente. | No funciona la creación manual desde el perfil EDITOR |  |  | Nuevo |
| DEF-009 | S1/S2/S3/S4 | MP-10 | Abrir recurso en review desde admin o URL de edicion. | Cuando se abre el recurso en review desde el perfil CURATOR y se pasa a borrador o a publicación se pierde el recurso y se muestra "recurso no encontrado" |  |  | Nuevo |
| DEF-010 | S1/S2/S3/S4 | MP-10 |Archivar recurso publicado. | Desde el perfil CURATOR la única acción disponible sobre recursos publicados es "LECTURA" |  |  | Nuevo |
| DEF-011 | S1/S2/S3/S4 | MP-10 | Restaurar archivado a borrador. | Desde el perfil CURATOR la única acción disponible sobre recursos publicados es "LECTURA" |  |  | Nuevo |
| DEF-012 | S1/S2/S3/S4 | MP-11 | Cortar red durante una subida pequena si es viable. | No se ha podido reproducir al ser el despliegue de prueba local |  |  | Nuevo |
| DEF-0013 | S1/S2/S3/S4 | MP-14 | Usar acciones rapidas a recursos, colecciones y categorias. | Desde el selector izquierdo cuando se selecciona AYUDA se pierde dicho selector y no se puede intercambiar con otro elemento del mismo |  |  | Nuevo |
| DEF-014 | S1/S2/S3/S4 | MP-15 | Buscar por titulo o autor. | La búsqueda resulta imprecisa. Si se buscar "Humberto" no arroja resultados a pesar de ser el nombre de dos autores. Si se busca el apellido de algún autor no arroja resultados. Algunas búsquedas arrojan resultados que en los campos del listado no se visualizan resultados conincidentes con los campos mostrados. |  |  | Nuevo |
| DEF-015 | S1/S2/S3/S4 | MP-16 | Reordenar con subir/bajar. | Funciona pero el ancho del box de edición no permite a primera vista visualizar los botones de edición en el listado de recursos |  |  | Nuevo |
| DEF-016 | S1/S2/S3/S4 | MP-17 | Filtrar por Materia, Nivel, Etiqueta. | No funciona por no coincidir con los valores de tipo del listado de taxonomías |  |  | Nuevo |
| DEF-017 | S1/S2/S3/S4 | MP-17 | Editar nombre/tipo/padre si aplica. | No admite cambios en el campo PADRE, no actualiza tipo en el listado de elementos del selector PADRE |  |  | Nuevo |
| DEF-018 | S1/S2/S3/S4 | MP-17 | Intentar crear duplicado o nombre vacio. | En el aviso "Ya existe una taxonomía con el nombre «mitaxonomia00» y tipo «tag»" no muestra valor TIPO de la taxonomía. Permite el mismo NOMBRE de taxonomía con distinto TIPO|  |  | Nuevo |
| DEF-019 | S1/S2/S3/S4 | MP-18 | Crear usuario nuevo con email unico y password >= 8. | Cuando se crea usuario la pantalla se va a blanco. Cuando se refresca se puede comprobar que la sesión abierta pertenece al nuevo usuario. No hay campo de APELLIDO para los usuarios. No estaría de más que hubiese un campo de entidad de pertenencia |  |  | Nuevo |
| DEF-020 | S1/S2/S3/S4 | MP-18 | Probar eliminar usuario de prueba. | Después de confirmar el borrado el usuario no desaparece del listado |  |  | Nuevo |
| DEF-021 | S1/S2/S3/S4 | MP-19 | Como curator, abrir seccion usuarios por URL directa. | Falla, desde curator se puede abrir /admin?section=users |  |  | Nuevo |
| DEF-001 | S1/S2/S3/S4 | MP-XX |  |  |  |  | Nuevo |
| DEF-001 | S1/S2/S3/S4 | MP-XX |  |  |  |  | Nuevo |
| DEF-001 | S1/S2/S3/S4 | MP-XX |  |  |  |  | Nuevo |

Severidades:

- `S1 bloqueante`: impide login, carga principal, publicacion, datos o backoffice.
- `S2 alta`: rompe un flujo principal pero existe alternativa.
- `S3 media`: error funcional acotado, inconsistencia de permisos, validacion o persistencia.
- `S4 baja`: texto, estilo, accesibilidad menor o mejora UX.

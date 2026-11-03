# Requirements — Revisión editorial y sello «Validado»

* Issues: #496 (flujo de revisión) y #420 (recursos validados del Procomún antiguo)
* ADR: ADR-0049 (Propuesto)
* Fecha: 2026-11-03

## Problema público

Cuando un recurso no está listo para publicarse, su autor no sabe por qué ni qué tiene que cambiar. El curator solo puede devolverlo a borrador, sin motivo, y no queda rastro de la decisión. Además, quien consulta el catálogo no distingue un recurso que revisó un curator de uno que un editor publicó sin revisión (ADR-0016). Así se pierde una señal de calidad que el Procomún antiguo sí daba en 877 recursos.

## Usuarios principales

* **Autor o autora** del recurso, que necesita saber qué corregir y cuándo hay una decisión.
* **Curator o admin**, que revisa, decide y deja constancia.
* **Docente que reutiliza recursos**, que quiere ver qué recursos ha revisado el equipo de curación.

## Alcance

### Dentro (fase 1)

1. Estados nuevos `changes_requested` y `rejected`. «Pendiente» y «En revisión» se distinguen por el curator asignado.
2. Acciones por rol con motivo obligatorio para pedir correcciones, rechazar, archivar y reabrir.
3. Cola de revisión con las vistas «Sin asignar», «Asignados a mí», «Con correcciones solicitadas» y «Validación solicitada».
4. Hilo privado de comentarios por recurso.
5. Historial de cambios de estado y decisiones para auditoría.
6. Notificaciones dentro de la aplicación y por correo, si está activado.
7. Sello «Validado»: se guarda, se pone, se quita y se ve en la ficha y en las tarjetas. También para los importados con `certified`.
8. Lista de comprobación del curator al aprobar o validar.

### Fuera (fase 2 o más adelante)

* Filtro «Solo validados» en el buscador y su faceta.
* Cambios pendientes sobre un recurso publicado (G2 de ADR-0049).
* IA de apoyo (decidido: fuera por ahora).
* Revisión de colecciones.
* Exportación LOM-ES del sello.

## Requisitos funcionales

* **RF-1.** El creador envía a revisión un recurso en `draft` o `changes_requested` si cumple los campos de #408. Si falta alguno, recibe un 400 con los campos que faltan, como hoy.
* **RF-2.** Un curator o un admin puede asignarse un recurso en `review`. Un admin puede reasignarlo a otro curator.
* **RF-3.** Un curator o un admin aprueba y publica, solicita correcciones o rechaza. Pedir correcciones y rechazar exige un motivo no vacío.
* **RF-4.** Para aprobar o validar hay que marcar todos los puntos de la lista de comprobación. Lo marcado queda en el historial.
* **RF-5.** En `changes_requested` el creador edita el recurso, comenta y lo reenvía a revisión.
* **RF-6.** El creador puede retirar de revisión su recurso mientras nadie haya decidido.
* **RF-7.** Solo un admin reabre un recurso rechazado, con motivo.
* **RF-8.** El creador, los curators que pueden verlo y el admin leen y escriben en el hilo de revisión. Cada comentario muestra autor, rol, fecha y, si se indica, el aspecto (contenido, accesibilidad, licencia, metadatos, fuentes u otro).
* **RF-9.** Ningún comentario ni motivo de revisión aparece en la ficha pública, la API v1, los feeds, la búsqueda ni las exportaciones.
* **RF-10.** Cada cambio de estado, asignación, validación o pérdida del sello deja un evento con actor, rol, fecha, motivo y versión. El evento se escribe en la misma transacción que el cambio.
* **RF-11.** El creador recibe una notificación cuando se solicitan correcciones, se aprueba, se rechaza, se valida, se archiva o se reabre su recurso. El curator asignado la recibe cuando se reenvía, se retira o se le asigna. Como mucho, una por evento y destinatario. Nunca la recibe quien hace la acción.
* **RF-12.** Si el correo está activado y el usuario no lo ha desactivado, cada notificación de cambio de estado se envía también por correo, como mucho una vez.
* **RF-13.** Un recurso aprobado y publicado desde `review` por un curator o un admin queda validado. Uno publicado directamente, no.
* **RF-14.** Si el creador, sin rol curator ni admin, cambia el contenido o los metadatos de un recurso publicado y validado, el recurso pierde el sello y queda un evento. Antes de guardar se le avisa.
* **RF-15.** Las ediciones de un curator o un admin conservan el sello.
* **RF-16.** El creador de un recurso publicado sin sello puede solicitar la validación. Un curator o un admin lo valida, o pide correcciones con motivo sin despublicarlo.
* **RF-17.** Los recursos legacy con `certified` activo que entran como `published` llevan el sello (`validation_source = 'legacy'`). `import:legacy-procomun --mark-certified` lo aplica a lo ya importado, con `--dry-run` e informe.
* **RF-18.** La ficha y las tarjetas muestran el distintivo «Validado». La API v1 y los feeds exponen `validated` y `validatedAt`.
* **RF-19.** El servidor devuelve las acciones permitidas para el usuario en cada recurso (`allowedActions`) y el frontend no repite las reglas.
* **RF-20.** Cuando un recurso vuelve a revisión, el curator ve qué metadatos cambiaron desde la ronda anterior y si hay un `.elpx` nuevo, sin perder los comentarios de esa ronda.

## Requisitos no funcionales

* **RNF-1 (seguridad).** Los permisos se comprueban en el servidor con la misma función que calcula `allowedActions`. Los comentarios se guardan y se muestran como texto plano.
* **RNF-2 (trazabilidad).** El historial es append-only: no hay ruta para editarlo ni borrarlo.
* **RNF-3 (privacidad).** El hilo y el historial solo se sirven bajo `/api/admin/`. En público no se muestra quién validó. Al borrar un usuario, sus comentarios quedan sin autor.
* **RNF-4 (accesibilidad, WCAG 2.2 AA).** Estados y sello con texto, diálogos con foco gestionado, campos con etiqueta y errores asociados, línea de tiempo como lista ordenada y campana con nombre accesible.
* **RNF-5 (rendimiento).** El sello se lee de una columna de `resources`, sin subconsultas en los listados. La cola y las notificaciones usan índices propios.
* **RNF-6 (disponibilidad).** Si el SMTP falla, la decisión se guarda igualmente y el correo se reintenta.
* **RNF-7 (mantenibilidad).** Una sola tabla de transiciones en `packages/db/src/validation.ts`.

## Criterios de aceptación (de las issues)

* Un autor puede enviar un recurso a revisión.
* Un curator autorizado puede aprobar, solicitar correcciones o rechazar con motivo.
* El autor recibe las observaciones asociadas al recurso y puede consultarlas.
* El autor puede modificar el recurso y reenviarlo tras las correcciones.
* Se conserva el historial de comentarios, decisiones y cambios de estado.
* Los comentarios de revisión no son públicos.
* Los roles sin permisos no pueden publicar directamente ni resolver revisiones.
* Los recursos revisados y publicados por un curator llevan el sello «Validado» y los publicados directamente por un editor no.
* Los importados con `certified` activo llevan el sello.
* El sello se ve en la ficha del recurso.

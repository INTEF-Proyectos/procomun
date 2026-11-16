# ADR-0051 Tratamiento de datos personales y baja de cuentas

* Estado: Propuesto
* Fecha: 2026-11-16
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/empresa-y-producto, @.agents/skills/arquitectura-solucion, @.agents/skills/backend-api-servicios, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/documentacion-y-roadmap]

## Contexto y Problema

Issue #504, que sale de #494. La plataforma nueva no informa de la protección de datos en el registro, no tiene páginas legales, no explica cómo ejercer los derechos y no permite darse de baja. ADR-0015 trata el ENS, que es seguridad, no protección de datos.

El INTEF ha respondido en #504 (2026-11-03 y 2026-11-16):

- El responsable es el INTEF. El tratamiento del Procomún antiguo se llama «Red social docente».
- La base jurídica es el art. 6.1.e del RGPD (misión realizada en interés público), con la LOE modificada por la LOMLOE.
- Los derechos se ejercen en la [sede electrónica del Ministerio](https://www.educacionyfp.gob.es/servicios-al-ciudadano/catalogo/varios/proteccion-datos.html), presencialmente o por correo postal.
- Los textos legales vigentes son el [aviso legal](https://procomun.intef.es/es/contenido/aviso_legal), la [política de privacidad](https://procomun.intef.es/es/contenido/politica_de_privacidad) y la [política de cookies](https://procomun.intef.es/es/contenido/politica_de_cookies) de procomun.intef.es.
- La foto de perfil necesita consentimiento.
- En el Procomún antiguo la baja borra el usuario y sus contenidos, y guarda `uid`, `name`, `surname`, `mail` y `remove_date` en `intef_users_removed`.
- No hay procedimiento para menores; queda por decidir.

El diseño completo está en `docs/epics/epic-0XX-proteccion-de-datos/design.md`.

## Opciones Consideradas

Sobre la casilla del registro:

* Pedir consentimiento al tratamiento, como hace el texto del Procomún antiguo.
* Informar y pedir la aceptación de las condiciones de uso, con consentimientos separados solo para lo que se base en el consentimiento.

Sobre los recursos de quien se da de baja:

* A. Borrar todo, como el Procomún antiguo.
* B. Conservarlos siempre, anonimizados.
* C. Que el usuario elija: conservarlos con su nombre, conservarlos sin su nombre o borrarlos.
* D. Transferirlos a una cuenta institucional.

Sobre el registro de bajas:

* Copiar `intef_users_removed` (identificador, nombre, apellidos, correo y fecha).
* Guardar solo el identificador interno, las fechas, el origen, la referencia del expediente y la elección sobre los recursos, con un plazo de conservación.

## Decisión

1. **Base jurídica y aceptación.** El tratamiento se basa en el art. 6.1.e del RGPD. El registro informa en dos capas y exige aceptar las condiciones de uso; esa aceptación no es un consentimiento al tratamiento. Solo lo que se base en el consentimiento (hoy, la foto de perfil) lleva una casilla aparte, opcional y revocable.
2. **Aceptaciones versionadas.** Se guarda usuario, documento, versión, fecha y canal, sin IP. Un cambio de versión vuelve a pedir la aceptación.
3. **Primer acceso.** Las cuentas importadas y las creadas por OIDC aceptan en su primer acceso. No aceptar no borra nada: impide usar la cuenta.
4. **Páginas legales.** Se enlazan los textos vigentes del INTEF; cuando el INTEF los adapte, se publican como páginas propias versionadas en el repositorio.
5. **Derechos.** Se ejercen en la sede. La plataforma explica cómo en «Tus datos», ofrece lo que el usuario ya puede hacer solo y da a los administradores la exportación de datos y la baja para atender las solicitudes.
6. **Baja.** Baja lógica inmediata y purga a los 30 días. Se borra siempre todo lo que no está publicado; con lo publicado se aplica la opción C, y si la baja llega por la sede sin elección, se conservan los recursos sin nombre. Los recursos conservados pasan a una cuenta de sistema.
7. **Registro de bajas.** Sin nombre ni correo, con borrado automático al cumplirse el plazo (propuesta: 3 años).
8. **Perfil.** Campos privados por defecto, públicos solo por acción expresa y filtrados en el servidor (ADR-0037). El correo nunca es público.
9. **Cookies y terceros.** Solo almacenamiento técnico o de preferencias; sin peticiones a terceros al cargar las páginas. Se quita Gravatar. Sin banner de consentimiento.

Los puntos 3, 6 y 7, y la edad mínima para registrarse, están pendientes de confirmación del INTEF en #504. Esta ADR pasa a Aceptado cuando se confirmen.

## Consecuencias

### Positivas
* El texto del registro deja de presentar como consentimiento algo que no lo es, y la base jurídica no depende de que el usuario lo retire.
* Las aceptaciones versionadas permiten demostrar qué texto vio cada usuario.
* Los recursos abiertos que otros reutilizan no desaparecen con la cuenta de su autor, salvo que el autor lo pida.
* El registro de bajas cumple la minimización y tiene fecha de caducidad.
* Sin terceros ni banner de cookies.

### Negativas / Riesgos
* La baja con elección y la purga programada son más trabajo que el borrado del Procomún antiguo, y hay que proteger las subidas de los recursos conservados frente al `ON DELETE CASCADE` de `upload_sessions.owner_id`.
* Los usuarios que pierdan la foto de Gravatar tendrán que subir una.
* Mientras el INTEF no adapte los textos legales, la plataforma enlaza textos que describen el Procomún antiguo.
* Si la responsable legal considera analítico el identificador del contador de visitas (ADR-0044), habrá que pedir consentimiento o cambiar el recuento.

## Notas de Implementación

* Las fases y tareas están en `docs/epics/epic-0XX-proteccion-de-datos/tasks.md`. Cada una se abre como issue propia.
* #533 aplica la visibilidad por campo del §6 del diseño.
* La épica de comunidades (#493) incorpora las reglas del §7 del diseño sobre los datos de los miembros.
* Las migraciones nuevas (`legal_acceptances`, `account_removals`, visibilidad del perfil) cogen número cuando se implementen, revisando antes los PR abiertos.

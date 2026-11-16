# Design — Épica XX: protección de datos en el área de usuario

## Fecha
2026-11-16

## Referencias
- Requisitos: `requirements.md`.
- Decisión: [ADR-0051](../../negocio/decisiones/0051-tratamiento-datos-personales-y-baja-de-cuentas.md).
- Issue: #504.

Las propuestas marcadas como **pendiente** necesitan respuesta del INTEF (ver §11). El diseño avanza con la propuesta y se ajusta cuando llegue la respuesta.

## 1. Información y aceptación en el registro

### No es consentimiento
La base jurídica es el art. 6.1.e del RGPD. El tratamiento no depende del consentimiento, así que la casilla del registro no puede presentarse como «consiento el tratamiento»: si lo fuera, el usuario podría retirarlo y el tratamiento se quedaría sin base. Lo que sí exige el RGPD es informar (art. 13), y lo que necesita la plataforma es que el usuario acepte las condiciones de uso.

El texto del Procomún antiguo mezcla las dos cosas («acepto que mis datos sean incorporados al tratamiento»). Se propone al INTEF separar:

- **Casilla obligatoria**: «He leído la información sobre protección de datos y acepto las condiciones de uso», con enlaces a la política de privacidad y al aviso legal.
- **Primera capa informativa**, junto al botón de registro, con el contenido del texto facilitado en #504: responsable (INTEF), tratamiento «Red social docente», finalidad, base jurídica (art. 6.1.e RGPD y LOE modificada por la LOMLOE), derechos y dónde ejercerlos (sede), y enlace a la segunda capa (política de privacidad).
- **Consentimientos separados**, solo para lo que sí se base en el consentimiento. Hoy es únicamente la foto de perfil (§1.3). Son opcionales, no vienen marcados y se pueden retirar desde el perfil.

La redacción final la valida la responsable legal del INTEF.

### Registro de aceptaciones
Tabla nueva `legal_acceptances`:

| Columna | Tipo | Nota |
|---|---|---|
| `user_id` | text, FK a `user`, `ON DELETE CASCADE` | |
| `document` | varchar | `terms` (condiciones y aviso legal) o `privacy` |
| `version` | varchar | identificador de la versión del documento, p. ej. `2026-11-16` |
| `accepted_at` | timestamp | |
| `channel` | varchar | `register`, `first_access`, `oidc`, `version_change` |

No se guarda la IP ni el agente de usuario: no hacen falta para demostrar que se informó, y la fecha y la versión ya lo prueban. La versión vigente de cada documento vive en configuración del servidor (`LEGAL_TERMS_VERSION`, `LEGAL_PRIVACY_VERSION`), de modo que publicar un texto nuevo y pedir de nuevo la aceptación es un cambio de configuración.

La API de registro rechaza el alta sin la aceptación (no basta con la casilla del formulario).

### Foto de perfil
El 2026-11-03 se acordó en #504 que la foto necesita consentimiento y se propuso quitar Gravatar. Se mantiene esa propuesta:

- La plataforma deja de pedir imágenes a gravatar.com.
- Cada usuario puede subir su foto a Procomún, con una casilla de consentimiento en el propio formulario de subida. Retirar el consentimiento borra la foto.
- Sin foto se muestra la inicial del nombre, como hoy cuando no hay `crypto.subtle`.

## 2. Usuarios importados y cuentas OIDC: primer acceso

Las cuentas importadas del Procomún antiguo (#456, #488) y las que se crean al entrar por OIDC (#540) no pasan por el formulario de registro.

**Propuesta (pendiente de confirmar, §11):** en su primer acceso, después de autenticarse y antes de cualquier otra pantalla, ven `/condiciones`:

- La misma primera capa del registro y, para los importados, una frase que explica que su cuenta y su perfil se han trasladado desde el Procomún antiguo, con el mismo responsable y la misma finalidad, y que los campos del perfil importados son privados hasta que los publiquen.
- La casilla de aceptación y dos botones: «Aceptar y continuar» y «Cerrar sesión».

Mientras no acepte, la sesión solo permite leer esa página, aceptar, cerrar sesión y darse de baja. El servidor lo aplica con un middleware que devuelve `403` con el código `terms_not_accepted` en el resto de rutas autenticadas. Los recursos públicos se siguen viendo sin iniciar sesión, como cualquier visitante.

Si el usuario no acepta, su cuenta y sus recursos quedan como están: el tratamiento no depende de que acepte, así que no aceptar no implica borrar nada. Lo único que no puede hacer es usar la plataforma con su cuenta.

El mismo mecanismo sirve cuando cambia la versión de un documento (`channel = version_change`).

## 3. Páginas legales

- **Ahora**: el pie de todas las páginas, el formulario de registro y `/condiciones` enlazan a los tres textos vigentes del INTEF en procomun.intef.es. No se copian ni se descargan.
- **Cuando el INTEF adapte los textos a la plataforma nueva**: rutas propias `/aviso-legal`, `/privacidad` y `/cookies`. El contenido se guarda en el repositorio como Markdown por idioma, con la versión en la cabecera, y se publica con un despliegue. Así cada versión queda en el historial de git y coincide con la que se pide aceptar. El castellano es el texto de referencia; en las demás lenguas, si no hay traducción, se muestra un aviso y el enlace al castellano.
- Las dos fases usan el mismo componente de pie con los enlaces en configuración, para que el cambio de destino no toque la interfaz.

Los textos actuales hablan del Procomún antiguo (por ejemplo, de sus cookies). Hay que pedir al INTEF que los revise antes de abrir la plataforma; mientras tanto, enlazarlos es mejor que no tener nada, pero es un riesgo (§10).

## 4. Ejercicio de derechos

Los derechos se ejercen en la sede del Ministerio, presencialmente o por correo postal, como indicó el INTEF. La plataforma no crea un procedimiento paralelo.

- **Sección «Tus datos»** en `/perfil`: explica qué datos se guardan, para qué y durante cuánto tiempo; enlaza a la política de privacidad y a la sede; y agrupa lo que el usuario ya puede hacer solo: editar el perfil (rectificación), cambiar la visibilidad de los campos, retirar el consentimiento de la foto y darse de baja.
- **Herramientas para quien atiende la sede**: cuando llega una solicitud, el equipo de administración tiene que poder responderla sin consultas a mano en la base de datos:
  - Exportar los datos de un usuario en JSON (cuenta, perfil, aceptaciones, recursos de los que es autor, colecciones, valoraciones, favoritos y comunidades). Sirve para el acceso y la portabilidad. Comando de `apps/cli` y acción en el panel de usuarios.
  - Ejecutar la baja (§5) indicando el origen `sede` y, si se quiere, la referencia del expediente.
- «Descargar mis datos» como autoservicio queda para una fase posterior: no es obligatorio si el derecho se ejerce en la sede, y la exportación del administrador ya cubre la necesidad.

## 5. Baja de la cuenta y recursos

### Situación
- En el Procomún antiguo, la baja borra el usuario y todos sus contenidos.
- En la plataforma nueva solo existe la baja lógica de administración: la cuenta queda desactivada y oculta, pero todos sus datos siguen ahí.

Borrar los recursos tiene impacto educativo: otros docentes los han enlazado, los han metido en colecciones o itinerarios, los han descargado y adaptado. Con licencia Creative Commons, además, quien los descargó puede seguir usándolos; borrarlos de Procomún solo rompe los enlaces y las colecciones de terceros. Por otro lado, el nombre del autor en la atribución es un dato personal, y las licencias CC 4.0 permiten al autor pedir que se retire su atribución.

### Opciones
| Opción | Qué pasa con los recursos publicados | A favor | En contra |
|---|---|---|---|
| A. Borrar todo (como hoy en el antiguo) | Se borran | Sencilla, coherente con lo actual | Rompe colecciones y enlaces de terceros; se pierde contenido abierto |
| B. Conservar siempre, anonimizados | Se quedan, con autor «Cuenta dada de baja» | No se pierde nada | El autor no puede retirar su obra; choca con el derecho de supresión si no hay excepción |
| C. Elige el usuario al darse de baja | Se quedan (con su nombre o anonimizados) o se borran | Respeta la decisión del autor y conserva lo que quiera dejar | Más pantalla y más casos que probar |
| D. Se transfieren a una cuenta institucional | Pasan a una cuenta del INTEF y conservan la atribución en texto | Siguen mantenidos | Exige que el INTEF asuma esos recursos; misma pega que B |

**Propuesta: C**, con estas reglas:

- **Siempre se borran**: borradores, recursos no publicados, subidas sin recurso publicado, valoraciones, favoritos, claves de API, perfil, foto, sesiones y cuentas vinculadas.
- **Recursos publicados**, a elección del usuario en la pantalla de baja:
  1. Mantenerlos con su nombre como autor (opción preseleccionada, porque es lo que pide la licencia CC).
  2. Mantenerlos sin su nombre: el autor pasa a «Autoría retirada».
  3. Borrarlos.
- Si los recursos se mantienen, `resources.created_by` y `resource_versions.created_by` pasan a una cuenta de sistema «Cuenta dada de baja» (sin correo ni credenciales), y el nombre visible sale del campo `resources.author`, que ya existe. Si se borran, las colecciones y comunidades que los incluían muestran «Recurso retirado» en su lugar.
- Las colecciones propias siguen la misma elección que los recursos.
- Cuando la baja llega por la sede sin elección expresa del interesado, se aplica la opción 2 (mantener sin nombre), salvo que pida borrarlos.

La excepción del art. 17.3.b del RGPD (cumplimiento de una misión de interés público) podría amparar conservar los recursos aunque el autor pida la supresión, pero eso lo tiene que decidir la responsable legal. Pendiente (§11).

### Cómo se ejecuta
1. **Baja inmediata**: al confirmar, la cuenta pasa a `deleted_at`, se borran las sesiones y deja de verse en la plataforma (igual que `softDeleteUser`).
2. **Purga a los 30 días**: un proceso programado borra físicamente los datos de las cuentas con `deleted_at` de más de 30 días y aplica la elección sobre los recursos. Los 30 días permiten deshacer una baja por error (solo un administrador, a petición del usuario). Una baja por la sede puede pedir la purga inmediata.
3. Antes de borrar el usuario se reasignan las referencias sin cascada y las subidas de recursos que se conservan, para que el `ON DELETE CASCADE` de `upload_sessions.owner_id` no arrastre ficheros de recursos publicados.
4. La purga escribe el registro de baja (§9) y un evento en `activity_events` sin datos personales.

Las copias de seguridad conservan los datos borrados hasta que rotan. La política de privacidad tiene que decirlo y el plazo de rotación lo fija operaciones.

## 6. Visibilidad de los campos del perfil (#533)

Sigue ADR-0037: privado por defecto y público solo por acción expresa.

| Campo | Por defecto | ¿Se puede hacer público? |
|---|---|---|
| Nombre para mostrar | Público si la persona publica recursos | Sí. Es el nombre de la atribución; quien no publica puede dejarlo privado |
| Correo | Privado | No, nunca |
| Rol | Público en la ficha de autor | No se configura |
| Foto | Privada hasta que la sube con consentimiento | Sí |
| «Sobre mí» | Privado | Sí |
| Centro educativo y su web | Privado | Sí |
| País y localidad | Privado | Sí |
| Web personal y redes | Privado | Sí |

- Una columna `user_profile.public_fields` (array de nombres de campo) o una por campo; se elige al implementar #533.
- El endpoint público del autor (#487) construye la respuesta solo con los campos públicos. El filtro está en el servidor y tiene su test.
- Los datos importados del Procomún antiguo entran privados aunque fueran públicos allí.

## 7. Datos de miembros en comunidades (#493)

La épica de comunidades se está diseñando en paralelo. Desde protección de datos se piden estas reglas:

- **Lista de miembros**: la ven los miembros de la comunidad y quien la gestiona. Fuera de ella, solo se muestra el número de miembros, también en las públicas.
- **Lo que se ve de cada miembro** es lo que su perfil tenga como público (§6), nunca el correo.
- **Solicitudes de incorporación**: las ve solo quien gestiona la comunidad. Se borran al resolverse; queda solo la pertenencia, si se aceptó.
- **Invitaciones** a personas sin cuenta: se guarda el correo solo hasta que se acepta o caduca (propuesta: 30 días) y luego se borra. El correo de invitación lo envía la plataforma, sin exponer la dirección a quien invita si no la escribió él.
- **Baja de la plataforma**: se borra la pertenencia y lo que haya aportado a la comunidad sigue la regla de §5.
- **Salir de una comunidad**: borra la pertenencia y la solicitud, si la había.

## 8. Cookies y almacenamiento en el navegador

Inventario a 2026-11-16:

| Elemento | Tipo | Finalidad | ¿Exento de consentimiento (art. 22.2 LSSI)? |
|---|---|---|---|
| Cookie de sesión de Better Auth | Cookie propia | Mantener la sesión | Sí, técnica |
| `localStorage["catalog-view"]` | Almacenamiento local propio | Recordar la vista del catálogo que eligió el usuario | Sí, preferencia pedida por el usuario |
| UUID en `sessionStorage` (ADR-0044) | Almacenamiento de sesión propio | No contar dos veces la misma visita | **A confirmar** con la responsable legal. Se propone tratarlo como técnico: no identifica a nadie, el servidor solo guarda su hash 24 h y no sale de la plataforma. Si se considera analítico, se pasa tras un consentimiento o se cuenta de otra forma |
| Petición a gravatar.com | Tercero | Avatar | No. Se elimina (§1.3) |
| Contenido embebido en un `.elpx` | Tercero | Vídeo o documento externo | Solo se carga tras pulsar la fachada (ADR-0027). La política de cookies tiene que explicarlo |

Con Gravatar fuera, la plataforma no necesita banner de consentimiento. La política de cookies, que ahora describe el Procomún antiguo, tiene que actualizarse con este inventario. Para que no se cuele un tercero sin darse cuenta, se añade un e2e que carga las páginas principales y falla si hay peticiones a otros orígenes o cookies no inventariadas.

## 9. Registro de bajas

El Procomún antiguo guarda en `intef_users_removed` el `uid`, el nombre, los apellidos, el correo y la fecha. Guardar nombre y correo de quien ha pedido la supresión contradice la minimización, salvo que haya una finalidad que lo justifique, y no se ha indicado ninguna.

**Propuesta**: tabla `account_removals`, sin datos que identifiquen a la persona por sí solos:

| Columna | Nota |
|---|---|
| `user_id` | El identificador interno, que ya no apunta a nada. Sirve para cruzar con `activity_events` y con las copias de seguridad |
| `requested_at`, `purged_at` | Fechas de la baja y de la purga |
| `origin` | `self`, `admin` o `sede` |
| `case_reference` | Referencia del expediente de la sede, opcional |
| `resources_choice` | `keep_named`, `keep_anonymous` o `delete` |

- Ni nombre, ni apellidos, ni correo.
- Si el INTEF necesita saber si un correo concreto se dio de baja (por ejemplo, para responder a una reclamación), se puede añadir un HMAC del correo con una clave del servidor: permite comprobar un correo concreto pero no listar los correos. Solo si el INTEF lo pide.
- **Conservación (pendiente, §11)**: propuesta de 3 años, el plazo de prescripción de las infracciones muy graves de la LOPDGDD (art. 72), y borrado automático por el mismo proceso de la purga.
- Las bajas que existan en `intef_users_removed` no se migran.

## 10. Riesgos
| ID | Descripción | Tipo | Control propuesto |
|---|---|---|---|
| R1 | Abrir la plataforma con textos legales que describen el Procomún antiguo | Legal | Pedir al INTEF la revisión antes de abrir; enlazarlos mientras tanto |
| R2 | Purgar una cuenta arrastra subidas de recursos que se conservan (`ON DELETE CASCADE` en `upload_sessions.owner_id`) | Técnico | Reasignar antes de borrar; test de integración de la purga |
| R3 | Un filtro de visibilidad solo en la interfaz expone campos privados por la API | Técnico | Filtrado en el servidor con tests |
| R4 | Menores que se registran y suben recursos sin procedimiento | Legal | Decisión pendiente (§11) |
| R5 | El identificador del contador de visitas se considera analítico | Legal | Confirmar; plan B descrito en §8 |
| R6 | Usuarios importados que nunca vuelven a entrar no reciben la información de la plataforma nueva | Legal | Valorar con el INTEF un aviso por correo antes de abrir |
| R7 | Las copias de seguridad conservan datos de cuentas purgadas | Legal y operación | Plazo de rotación documentado en la política de privacidad |

## 11. Decisiones pendientes
Se publican en #504 como preguntas, cada una con su propuesta:

1. **Menores**: limitar el registro a mayores de 14 años con una declaración en el registro, sin guardar la fecha de nacimiento.
2. **Recursos de quien se da de baja**: opción C de §5.
3. **Aceptación de los importados en su primer acceso**: como en §2.
4. **Conservación del registro de bajas**: 3 años, sin nombre ni correo (§9).

Además, para la responsable legal: la redacción de la casilla (§1), si el UUID del contador es técnico (§8) y si el art. 17.3.b ampara conservar recursos tras una supresión (§5).

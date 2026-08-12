# ADR-0037 Modelo de perfil y migración de usuarios legacy

* Estado: Propuesto
* Fecha: 2026-08-06
* Agentes Implicados: [@.agents/skills/empresa-y-producto, @.agents/skills/arquitectura-solucion, @.agents/skills/ingestas-y-migraciones, @.agents/skills/metadatos-y-curacion, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/documentacion-y-roadmap]

## Contexto y Problema

La migración de Procomún legacy dispone de `exportados-usuarios/usuarios.json`. La muestra observada contiene 28 campos por usuario y mezcla identidad, perfil educativo/profesional, localización, presencia web y datos especialmente sensibles o sin finalidad actual demostrada. El importador inicial solo contempla el mínimo de cuenta: identificador legacy, correo, nombre, estado y rol.

El equipo de migración necesita preservar la atribución y la información de perfil que ayude a reconocer autores y a reutilizar recursos, sin trasladar datos desproporcionados ni publicar datos históricos por defecto. La persona docente es la principal beneficiaria: debe poder identificar de forma fiable la autoría y contexto profesional de un recurso, mientras que la persona migrada conserva el control de la visibilidad de su perfil.

No se incluyen valores de ejemplo en esta ADR: el archivo de origen contiene datos personales y hashes de contraseña.

## Opciones Consideradas

* Mantener únicamente la cuenta mínima actual y descartar todo el perfil legacy.
* Copiar todos los campos de perfil al registro `user` de Better Auth durante la importación.
* Separar el perfil funcional de la cuenta de autenticación, clasificar campos por finalidad y migrar solo los autorizados con visibilidad privada por defecto.

## Decisión

Se propone la opción 3: mantener `user` como cuenta y autenticación, y añadir en una entrega posterior un perfil de usuario de dominio (`user_profile`) relacionado uno-a-uno con `user`. Ningún campo adicional se implementará ni cargará hasta que esta ADR sea aceptada y se complete la revisión de privacidad indicada más abajo.

El perfil separa datos de autenticación de datos de presentación y contexto educativo. La migración será idempotente por el identificador namespaced ya definido para el usuario legacy; las reejecuciones no sobrescribirán cambios posteriores realizados por la persona usuaria.

Los datos de presentación procedentes del legado (`display_name`, `bio` e `image`) pertenecen a `user_profile`, permanecen privados por defecto y se someten al mismo modelo de visibilidad por campo que el resto del perfil. Los campos homónimos o equivalentes que permanezcan en `user` por compatibilidad con Better Auth o con la cuenta mínima se consideran datos técnicos de cuenta y no son fuente de representación pública de autor.

### Clasificación y mapeo propuestos

| Origen legacy | Destino propuesto | Decisión y regla |
|---|---|---|
| `uid` | `user.id` / procedencia de migración | Conservar el ID namespaced actual; no duplicar el UID como identificador público. |
| `field_name_value`, `field_surname_value`, `field_surname_2_value`, fallback `name` | `user_profile.display_name` | Construir el nombre de presentación con partes no vacías; usar `name` solo como fallback. Normalizar espacios, importar como privado y no sobrescribir una edición posterior. El `user.name` técnico que ya pueda existir por la cuenta mínima queda fuera de la representación pública. |
| `field_sobre_mi_value` | `user_profile.bio` | Candidato a migración privada, con límite y saneado HTML/texto. No se copia a `user.bio`; solo se publica mediante una acción explícita de la persona usuaria. |
| `user_picture` | `user_profile.image` | Candidato condicionado a disponer de archivo, licencia/derechos y análisis antimalware. No se copia a `user.image`; sin esos controles se registra como incidencia y no se usa una URL heredada. |
| `field_educative_center_value`, `field_educative_center_url_uri` | `user_profile.organization`, `organizationUrl` | Campo de contexto educativo útil para atribución; URL validada como HTTPS y campo privado por defecto. |
| `field_user_ocupacion_actual_value`, `field_user_nivel_estudios_value`, `field_user_otros_estudios_value` | `user_profile.occupation`, `educationLevel`, `otherStudies` | Candidatos opcionales; texto normalizado, límites explícitos y visibilidad privada. Requieren revisión de utilidad editorial antes de habilitar publicación. |
| `field_country_country_code`, `field_country_administrative_area`, `field_country_locality` | `user_profile.countryCode`, `administrativeArea`, `locality` | País en ISO 3166-1 alfa-2 si es válido; resto opcional y privado. No se usará para búsqueda pública ni segmentación. |
| `field_website_value`, `field_user_facebook_value`, `field_user_linkedin_value`, `field_user_twitter_value` | `user_profile.links` | Lista normalizada con tipo y URL HTTPS. No se resuelve, rastrea ni publica automáticamente. |
| `timezone` | Preferencia de cuenta futura, fuera de `user_profile` | No migrar mientras no exista una preferencia de zona horaria con finalidad operativa definida. |
| `roles`, `status`, `mail` | Cuenta existente | Mantener las reglas del importador de cuentas; la ADR no modifica autorización ni verificación de correo. |
| `pass`, `field_dni_value`, `field_birthdate_value`, `field_sexo_value`, `field_descripcion_org_value` | — | Excluir. Contraseñas y DNI nunca se copian; fecha de nacimiento y sexo carecen de finalidad necesaria; la descripción de organización requiere fuente y base jurídica separadas. |

### Modelo lógico objetivo

La futura tabla `user_profile` tendrá `user_id` como clave primaria y clave foránea con borrado en cascada a `user`. Incluirá únicamente los campos de la tabla anterior que hayan superado la revisión de privacidad y un estado de visibilidad por campo, con valor inicial `private`. Las URLs sociales se almacenarán como datos estructurados validados, no como HTML.

`user` conserva exclusivamente los datos de cuenta y los campos que Better Auth o la cuenta mínima necesiten por compatibilidad. La migración de perfiles no copiará `bio` ni `image` a `user`; cualquier `user.name` técnico que ya exista no se utilizará para representación pública ni cambiará de visibilidad mediante esta ADR.

La propuesta no introduce endpoint público nuevo. La futura API deberá separar lectura propia autenticada, actualización propia y representación pública consentida; nunca deberá devolver campos privados al listar recursos o autores. La publicación será explícita por campo.

### Atribución, búsqueda y exposición pública

Antes de asociar usuarios legacy con recursos, la representación pública de autor y la búsqueda por autor deberán dejar de depender directamente de `user.name`. El código actual que exponga o indexe `user.name` como `createdByName` o como término de búsqueda deberá migrarse a una representación pública derivada de `user_profile.display_name` únicamente cuando ese campo tenga visibilidad pública.

Si `user_profile.display_name` no es público, la API no podrá usar `user.name` como fallback de presentación. El fallback editorial para recursos históricos deberá definirse en la feature de implementación —por ejemplo, conservar la atribución textual propia del recurso cuando exista— sin revelar campos privados de la cuenta.

Esta adaptación es una precondición para vincular cuentas legacy con recursos o habilitar búsqueda pública por autor. Hasta entonces, el importador mínimo de cuentas y la migración de perfiles permanecen desacoplados de la asociación con recursos.

### Flujo de migración posterior

1. Validar la versión del exportador, forma del JSON y campos permitidos.
2. Crear o localizar la cuenta por el ID legacy namespaced; no importar credenciales.
3. Normalizar y validar los campos admitidos; los inválidos generan incidencias por registro, sin abortar el lote.
4. Insertar el perfil en la misma transacción que la cuenta cuando corresponda, marcando cada campo como privado y registrando su procedencia legacy.
5. Registrar por campo `migration_batch_id`, identificador legacy, instante de importación y huella del valor normalizado; el informe del lote incluirá resultados y motivos sin valores personales.
6. Ante reejecución, un valor `null`, vacío o inválido se omite; un cambio del origen se registra como `changed-source-skipped`; los campos ya importados o editados por la persona usuaria no se sobrescriben.
7. El rollback por `migration_batch_id` solo podrá revertir valores que sigan asociados al mismo lote y cuya huella actual coincida con la huella importada; los campos editados, publicados o reasignados se omiten como conflicto.

## Consecuencias

### Positivas
* Conserva la atribución y el contexto educativo potencialmente útiles sin convertir Better Auth en un modelo de perfil amplio.
* Reduce exposición y lock-in: el perfil se puede exportar, suprimir o evolucionar sin afectar sesiones ni credenciales.
* Hace explícitos los campos que no se migran y evita que hashes, DNI o atributos sin finalidad entren en la nueva plataforma.
* Permite una ingesta repetible, trazable y reversible mediante procedencia por campo y lote de migración.
* Evita que datos técnicos de cuenta se conviertan accidentalmente en identidad pública o términos de búsqueda.

### Negativas / Riesgos
* La migración completa de perfiles se pospone hasta que exista migración de esquema, controles de visibilidad y validación de la base jurídica por el responsable del tratamiento.
* Algunos perfiles legacy quedarán con información incompleta frente al sistema original; se prefiere esta pérdida limitada a una retención desproporcionada.
* Las imágenes y enlaces requieren controles adicionales de procedencia, seguridad y derechos antes de importarse.
* La asociación automática de usuarios con recursos y la publicación de perfiles permanecen fuera de alcance hasta adaptar la atribución y búsqueda públicas al modelo de visibilidad definido en esta ADR.

## Notas de Implementación

Antes de implementar se debe completar una feature trazable en la épica 004 con requisitos, diseño, tareas y validación. Incluirá una migración Drizzle revisada, validadores TypeScript, pruebas unitarias e integración con PGlite/PostgreSQL, un `--dry-run`, informe sin PII y piloto con datos minimizados.

La feature deberá incluir pruebas que garanticen que los campos privados de `user_profile` y los datos técnicos de `user` no se filtran mediante listados de recursos, detalle, búsqueda, representación de autor ni endpoints públicos relacionados. También deberá cubrir la política de reimportación y rollback por lote descrita en esta ADR.

La aceptación de esta ADR exige una revisión conjunta de Producto, Arquitectura, Metadatos y Seguridad/Privacidad. Deben confirmarse finalidad, información a las personas afectadas, retención, ejercicio de derechos, visibilidad por defecto y el listado definitivo de campos. Hasta entonces, `import:legacy-users` conserva su alcance mínimo y no se ejecutará el lote completo de perfiles.

Relacionada con la issue #312, la épica `epic-004-migracion-legacy-procomun` y el importador inicial de usuarios propuesto en el PR #309.

## Adenda de revisión — 2026-08-12

La revisión del 12 de agosto queda incorporada en la decisión principal anterior. Esta adenda conserva la trazabilidad de los criterios que motivaron los ajustes y no introduce reglas alternativas.

### Privacidad de los datos de presentación

Los valores legacy destinados a presentación —nombre visible, biografía e imagen— se almacenan en `user_profile` como `display_name`, `bio` e `image`, sujetos a visibilidad por campo y con valor inicial `private`. `user.name`, `user.bio` y `user.image`, si continúan existiendo por compatibilidad con Better Auth o con la cuenta mínima, no son fuente de datos para la representación pública de autores ni para las respuestas públicas de recursos.

La asociación de usuarios legacy con recursos queda condicionada a que atribución y búsqueda públicas dejen de usar `user.name` directamente y respeten la visibilidad de `user_profile.display_name`.

### Procedencia y reversión por lote

Cada inserción o campo creado por la migración deberá registrar procedencia a nivel de campo: `migration_batch_id`, identificador legacy, instante de importación y una huella del valor normalizado. Una edición de la persona usuaria reemplaza esa procedencia por `user` y conserva la auditoría. El informe de lote contendrá solo identificadores y resultados, nunca valores personales.

El rollback de un `migration_batch_id` se realizará en una transacción y solo podrá eliminar el perfil, restablecer un campo o retirar un enlace cuando el registro siga marcado con ese mismo lote **y** la huella actual coincida con la huella importada. Si el campo fue editado, publicado o reasignado posteriormente, se omite y se informa como conflicto; nunca se sobrescribe una edición posterior. El rollback no borrará cuentas, sesiones ni recursos ya existentes, y mantendrá un registro auditable de los elementos revertidos y omitidos.

### Política de reimportación

La política inicial es de alta única y no sobrescritura:

1. Un valor legacy `null`, vacío o inválido no crea ni borra un campo y se anota como omitido.
2. Para un usuario ya importado, los valores legacy distintos se detectan mediante su huella y se anotan como `changed-source-skipped`; no actualizan el perfil ni su visibilidad.
3. Los campos ya editados por la persona usuaria nunca se modifican, incluso si el valor legacy vuelve a cambiar.
4. Una actualización desde el origen solo podrá existir en una feature posterior, con consentimiento/base jurídica revisados, comparación por campo y una regla explícita limitada a valores que sigan teniendo procedencia de migración.

Así el piloto implementará estas reglas cerradas, en lugar de decidirlas durante la ejecución. Cualquier política de sincronización posterior requerirá revisión de Producto, Seguridad/Privacidad y una nueva adenda o ADR.

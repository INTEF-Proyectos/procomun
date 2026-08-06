# ADR-0034 Modelo de perfil y migración de usuarios legacy

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

### Clasificación y mapeo propuestos

| Origen legacy | Destino propuesto | Decisión y regla |
|---|---|---|
| `uid` | `user.id` / procedencia de migración | Conservar el ID namespaced actual; no duplicar el UID como identificador público. |
| `field_name_value`, `field_surname_value`, `field_surname_2_value`, fallback `name` | `user.name` | Construir nombre visible con partes no vacías; usar `name` solo como fallback. Normalizar espacios y no sobrescribir una edición posterior. |
| `field_sobre_mi_value` | `user.bio` | Candidato a migración privada, con límite y saneado HTML/texto. Solo se publica mediante una acción explícita de la persona usuaria. |
| `user_picture` | `user.image` | Candidato condicionado a disponer de archivo, licencia/derechos y análisis antimalware; sin esos controles se registra como incidencia, no se usa una URL heredada. |
| `field_educative_center_value`, `field_educative_center_url_uri` | `user_profile.organization`, `organizationUrl` | Campo de contexto educativo útil para atribución; URL validada como HTTPS y perfil privado por defecto. |
| `field_user_ocupacion_actual_value`, `field_user_nivel_estudios_value`, `field_user_otros_estudios_value` | `user_profile.occupation`, `educationLevel`, `otherStudies` | Candidatos opcionales; texto normalizado, límites explícitos y visibilidad privada. Requieren revisión de utilidad editorial antes de habilitar publicación. |
| `field_country_country_code`, `field_country_administrative_area`, `field_country_locality` | `user_profile.countryCode`, `administrativeArea`, `locality` | País en ISO 3166-1 alfa-2 si es válido; resto opcional y privado. No se usará para búsqueda pública ni segmentación. |
| `field_website_value`, `field_user_facebook_value`, `field_user_linkedin_value`, `field_user_twitter_value` | `user_profile.links` | Lista normalizada con tipo y URL HTTPS. No se resuelve, rastrea ni publica automáticamente. |
| `timezone` | Preferencia de cuenta futura, fuera de `user_profile` | No migrar mientras no exista una preferencia de zona horaria con finalidad operativa definida. |
| `roles`, `status`, `mail` | Cuenta existente | Mantener las reglas del importador de cuentas; la ADR no modifica autorización ni verificación de correo. |
| `pass`, `field_dni_value`, `field_birthdate_value`, `field_sexo_value`, `field_descripcion_org_value` | — | Excluir. Contraseñas y DNI nunca se copian; fecha de nacimiento y sexo carecen de finalidad necesaria; la descripción de organización requiere fuente y base jurídica separadas. |

### Modelo lógico objetivo

La futura tabla `user_profile` tendrá `user_id` como clave primaria y clave foránea con borrado en cascada a `user`. Incluirá únicamente los campos de la tabla anterior que hayan superado la revisión de privacidad, más `visibility` por campo o, como mínimo, un estado de perfil privado. Las URLs sociales se almacenarán como datos estructurados validados, no como HTML. `user` conserva los campos de Better Auth y los actuales `name`, `image` y `bio` para no acoplar el autenticador a atributos educativos.

La propuesta no introduce endpoint público nuevo. La futura API deberá separar lectura propia autenticada, actualización propia y representación pública consentida; nunca deberá devolver el perfil privado al listar recursos o autores.

### Flujo de migración posterior

1. Validar la versión del exportador, forma del JSON y campos permitidos.
2. Crear o localizar la cuenta por el ID legacy namespaced; no importar credenciales.
3. Normalizar y validar los campos admitidos; los inválidos generan incidencias por registro, sin abortar el lote.
4. Insertar el perfil en la misma transacción que la cuenta cuando corresponda, marcándolo privado y con procedencia legacy.
5. Emitir un informe por lote con campos importados, omitidos, bloqueados y motivo; no incluir valores personales en logs.
6. Ante reejecución, no modificar campos editados después de la importación; un piloto definirá el marcador de procedencia y la regla de no sobrescritura.

## Consecuencias

### Positivas
* Conserva la atribución y el contexto educativo potencialmente útiles sin convertir Better Auth en un modelo de perfil amplio.
* Reduce exposición y lock-in: el perfil se puede exportar, suprimir o evolucionar sin afectar sesiones ni credenciales.
* Hace explícitos los campos que no se migran y evita que hashes, DNI o atributos sin finalidad entren en la nueva plataforma.
* Permite una ingesta repetible, trazable y reversible por informe de lote.

### Negativas / Riesgos
* La migración completa de perfiles se pospone hasta que exista migración de esquema, controles de visibilidad y validación de la base jurídica por el responsable del tratamiento.
* Algunos perfiles legacy quedarán con información incompleta frente al sistema original; se prefiere esta pérdida limitada a una retención desproporcionada.
* Las imágenes y enlaces requieren controles adicionales de procedencia, seguridad y derechos antes de importarse.
* La asociación automática de usuarios con recursos y la publicación de perfiles permanecen fuera de alcance; requieren una decisión editorial posterior.

## Notas de Implementación

Antes de implementar se debe completar una feature trazable en la épica 004 con requisitos, diseño, tareas y validación. Incluirá una migración Drizzle revisada, validadores TypeScript, pruebas unitarias e integración con PGlite/PostgreSQL, un `--dry-run`, informe sin PII y piloto con datos minimizados.

La aceptación de esta ADR exige una revisión conjunta de Producto, Arquitectura, Metadatos y Seguridad/Privacidad. Deben confirmarse finalidad, información a las personas afectadas, retención, ejercicio de derechos, visibilidad por defecto y el listado definitivo de campos. Hasta entonces, `import:legacy-users` conserva su alcance mínimo y no se ejecutará el lote completo de perfiles.

Relacionada con la issue #312, la épica `epic-004-migracion-legacy-procomun` y el importador inicial de usuarios propuesto en el PR #309.

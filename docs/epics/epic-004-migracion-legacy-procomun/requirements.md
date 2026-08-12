# Requirements — Épica 004: importador de recursos legacy Procomún (.elpx)

## Fecha
2026-07-10

## Origen
Matriz de decisión funcional (`docs/casos/matriz-decision-funcional-procomun/README.md`), filas F2-07 (migración de recursos legacy, P0), F2-08 (migración de usuarios, P0, pendiente de validar con INTEF) y F2-09 (migración de ficheros/formatos, P0, pendiente de validar formatos obligatorios con INTEF). Roadmap Fase 2 (`docs/producto/roadmap.md`), ítem "Migración desde Procomún".

## Problema público/educativo
La plataforma legacy "Procomún" en producción contiene ~78.800 ODEs (Objetos Digitales Educativos) y ~100.000 adjuntos multimedia. Sin un importador automático, todo ese catálogo histórico se pierde en la transición a `procomun-ng`, con el consiguiente daño a la reutilización de recursos ya creados y usados por la comunidad docente.

## Usuario principal
Equipo de migración/curación (rol `curator`/`admin`) que ejecuta la importación por lotes y revisa editorialmente los recursos resultantes antes de publicarlos.

## Contexto de datos disponible
- `ode-export/` (directorio local, no versionado): 9 pares `<id>.json` + `<id>.elpx` de ejemplo real, usados como base de análisis y como fixture de piloto.
- El `.json` contiene ~39 campos de metadatos tipo LOM/Dublin Core (`titleStr`, `descriptionStr`, `generalLanguageStr`, `rightsCopyrightAndOtherRestrictionsStr`, `knowledgeArea`, `learningContext`, `resourceType`, `authorStr`, `labelsStr`, `idODE`, `rutaAccesoContenidos`, `publicationDate`, etc.).
- El `.elpx` es un paquete eXeLearning (ZIP), formato ya soportado nativamente por `procomun-ng` (ver `apps/api/src/services/elpx-processor.ts`).
- **No existe documentación contractual completa del formato de exportación legacy** (PPT del expediente `CE01698/2023` pendiente de obtener, ver `docs/casos/contexto-procomun-legacy/`). El esquema de mapeo se basa en los 9 ejemplos observados, no en una especificación cerrada.

## Objetivo de la épica
Entregar un importador automático (CLI, idempotente, con dry-run) capaz de convertir pares `.json`+`.elpx` legacy en recursos válidos de `procomun-ng`, piloteado sobre los 9 ejemplos disponibles, sentando la base técnica para escalar después al volumen real cuando se resuelvan las decisiones de negocio pendientes.

## Requisitos funcionales mínimos
- RF-001: leer un directorio con pares `<id>.json`+`<id>.elpx` y emparejarlos por nombre base.
- RF-002: mapear los campos del JSON legacy al perfil mínimo de metadatos (ADR-0009) con normalización de idioma, licencia y tipo de recurso.
- RF-003: reutilizar el pipeline de procesamiento `.elpx` ya existente (`parseElpxMetadata`, `processElpxUpload`, `safeExtractElpx`) sin reimplementarlo.
- RF-004: persistir cada recurso importado de forma idempotente — reejecutar el importador sobre el mismo origen no debe crear duplicados.
- RF-005: soportar modo `--dry-run` que valida y mapea sin escribir en base de datos.
- RF-006: generar un informe de ejecución (`informe_ingesta.json`) con métricas de calidad (importados, omitidos, errores bloqueantes por causa, warnings tolerables).
- RF-007: distinguir errores bloqueantes (se salta el registro) de errores tolerables (se importa con warning) según reglas explícitas.

## Requisitos no funcionales
- Idempotencia garantizada a nivel de base de datos (índice único), no solo de aplicación.
- Un fallo en un registro no debe abortar el procesamiento del resto del lote.
- Todo `.ts` productivo nuevo debe llevar su test emparejado (regla AGENTS.md).
- Reutilización estricta de la extracción segura anti zip-slip/symlink/zip-bomb ya auditada (ADR-0026a) — el importador no toca la seguridad de apertura de `.elpx`.

## Fuera de alcance (esta entrega)
- Formatos SCORM 1.2/2004, ePUB, IMS, enlaces externos (F2-09, pendiente de validar con INTEF qué formatos son obligatorios de preservación).
- Migración de usuarios/autoría real como cuentas de `procomun-ng` (F2-08, pendiente con INTEF); la autoría legacy se guarda como texto libre.
- Ejecución sobre el volumen completo (~78.800 ODEs) — condicionada a decisiones de negocio pendientes y a disponibilidad real del dataset.
- Indexación FTS del contenido interno del `.elpx` (el extractor actual de `apps/api/src/fts/extract.ts` no abre el `index.html` interno del paquete).
- Conexión con la tabla `taxonomies` (hoy desconectada de `resources`); se mantiene el patrón de texto libre ya usado en el resto del sistema para `resource_subjects`/`resource_levels`.

## Riesgos y supuestos
- El esquema de origen está inferido de 9 ejemplos reales, no de una especificación oficial completa; el volumen real puede contener variantes no vistas.
- Se detectó y corrigió un bug real en `packages/db/src/elpx-metadata.ts` (claves `pp_license`/`pp_lang` no mapeadas) que impedía extraer `language`/`license` de prácticamente cualquier `.elpx` real — prerrequisito de esta épica, ver ADR-0029.
- Decisiones de negocio pendientes con INTEF (alcance completo vs. selectivo, tratamiento de usuarios históricos, formatos legacy adicionales obligatorios) no bloquean esta iteración técnica pero sí la ejecución sobre volumen real.

## Ampliación — importación inicial de usuarios (2026-08-06)

### Problema, usuario y alcance

El exportador legacy genera un único `usuarios.json`, cuya raíz es un array de usuarios Drupal. Esta ampliación permite al equipo de migración conservar las cuentas históricas mínimas antes de decidir cómo enlazarlas con recursos y autorías. El usuario principal es el operador de migración con acceso al CLI.

Se implementa `import:legacy-users` para crear cuentas de `procomun-ng` desde ese archivo, con `--dry-run`, `--limit` e informe de lote. Esta entrega **no** asocia usuarios con recursos ni conserva campos de perfil ampliado, imágenes o redes sociales.

### Requisitos funcionales

- Leer un JSON cuyo nivel raíz sea un array y aislar el error de cada registro mal formado.
- Importar `uid`, `name`, `mail` y `roles`; `status` se conserva únicamente como dato de origen y no desactiva la cuenta destino.
- Reejecutar el mismo archivo sin crear duplicados: el ID destino es estable y namespaced por `uid` legacy; un correo ya existente tampoco se reemplaza.
- Emitir un informe por ejecución con importados, omisiones por UID/correo y errores.

### Seguridad, privacidad y autenticación

- No se copia `pass`: los hashes Drupal observados no son compatibles ni se deben reutilizar como credenciales Better Auth.
- Las cuentas importadas quedan sin cuenta `credential` y con `email_verified = false`; deberán recuperar/establecer contraseña mediante correo o usar un proveedor de identidad antes de iniciar sesión.
- El rol `administrator` se traduce a `admin`; el resto de usuarios se traduce a `editor` para conservar la capacidad de publicación directa existente en Procomún legacy.
- Todas las cuentas que superan la validación y se importan quedan con `is_active = true`, independientemente del valor legacy de `status`.

### Riesgos abiertos

- El formato se ha inferido de `exportados-usuarios/usuarios.json` (muestra de cuatro registros), no de una especificación contractual.
- La asociación de autorías y la futura exclusión del buscador de recursos publicados directamente por editores requieren una iteración posterior.

### Actualización de política de rol (2026-08-06)

Por decisión de producto posterior a la implementación inicial, todos los usuarios importados reciben el rol `editor`, incluidos los que el legacy marca como `administrator`. El valor `roles` se conserva solo como dato de origen no persistido y no genera privilegios en `procomun-ng`. Esta política evita elevar cuentas históricas sin revisión y permite que las cuentas creen y editen sus propios recursos; la equivalencia definitiva de privilegios legacy sigue pendiente.

### Corrección de política de rol (2026-08-06)

La política anterior se corrige: los registros con `roles: "administrator"` se importan como `admin`; el resto se importa como `editor`. Esta equivalencia conserva el comportamiento de Procomún legacy, donde las personas registradas pueden crear recursos sin revisión previa. La exclusión del buscador de los recursos publicados directamente por editores se abordará en una iteración posterior.

### Decisión de activación de cuentas migradas (2026-08-12)

Por decisión funcional confirmada en la revisión del PR #309, toda cuenta legacy que supere la validación del importador se crea activa (`user.is_active = true`) aunque el origen tenga `status = 0`, otro valor o no incluya el campo. El objetivo es que las personas migradas puedan recuperar la contraseña mediante su correo y continuar usando la cuenta. El hash `pass` de Drupal no se migra y `email_verified` permanece en `false`; la recuperación/establecimiento de credenciales se resolverá mediante el flujo habitual de contraseña olvidada o el proveedor de identidad que corresponda.

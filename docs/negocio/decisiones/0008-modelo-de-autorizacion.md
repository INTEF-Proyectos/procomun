# ADR-0008 Modelo de autorización (RBAC)

* Estado: Aceptado
* Fecha: 2026-03-25
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal/SKILL.md, @.agents/skills/backend-api-servicios/SKILL.md, @.agents/skills/empresa-y-producto/SKILL.md]

## Contexto y Problema

La plataforma tiene dos áreas diferenciadas:

- **Vista pública**: búsqueda, navegación y consulta de recursos — sin autenticación.
- **Vista admin/editorial**: creación, edición, curación, moderación y gestión de usuarios — requiere autenticación y permisos por rol.

El modelo de dominio define cuatro roles: `admin`, `curator`, `author`, `reader`. Se necesita un sistema de autorización que:

1. Proteja las rutas admin/editorial.
2. Aplique permisos granulares según el rol del usuario.
3. Sea declarativo y auditable (no lógica ad-hoc dispersa en handlers).
4. Se integre con Better Auth (ADR-0007).

## Opciones Consideradas

* Better Auth admin plugin con `createAccessControl`
* CASL (librería de permisos isomórfica)
* Middleware custom con tabla de permisos propia

### Better Auth admin plugin

**Pros**
- Integrado con la librería de auth ya elegida (ADR-0007).
- API declarativa: `createAccessControl` define statements y roles en un solo lugar.
- Los permisos se evalúan server-side sin dependencias adicionales.
- Soporta roles custom con herencia de permisos.

**Contras**
- Acoplado a Better Auth.
- Menos expresivo que CASL para políticas muy complejas (condiciones por campo, ownership).

### CASL

**Pros**
- Muy expresivo: soporta condiciones por campo, ownership, y políticas complejas.
- Isomórfico (puede usarse en frontend y backend).

**Contras**
- Añade una dependencia adicional sobre la ya existente (Better Auth).
- Sobreingeniería para el nivel actual de complejidad de permisos.
- Requiere sincronización manual con el sistema de sesiones.

### Middleware custom

**Pros**
- Control total, sin dependencias.

**Contras**
- Contradice regla 8 (desarrollo propio innecesario).
- Mayor superficie de código y riesgo de errores.
- Sin estructura declarativa ni auditable.

## Decisión

Se adopta el **plugin admin de Better Auth con `createAccessControl`** para el modelo de autorización.

Justificación:

1. **Integración directa** con el sistema de auth ya decidido — sin capas adicionales.
2. **Declarativo**: los permisos se definen en un fichero central (`permissions.ts`), auditable y versionable.
3. **Suficiente expresividad** para los cuatro roles y los recursos del dominio actual.
4. **Mínima complejidad**: no añade dependencias ni abstracciones sobre lo ya elegido.

## Modelo de permisos

### Entidades y acciones

| Entidad | Acciones |
|---------|----------|
| resource | create, read, update, delete, curate, moderate |
| collection | create, read, update, delete |
| user | create, read, update, delete, ban |

### Permisos por rol

| Acción | reader | author | curator | admin |
|--------|--------|--------|---------|-------|
| resource:read | ✓ | ✓ | ✓ | ✓ |
| resource:create | | ✓ | ✓ | ✓ |
| resource:update | | ✓ (propios) | ✓ | ✓ |
| resource:delete | | | | ✓ |
| resource:curate | | | ✓ | ✓ |
| resource:moderate | | | | ✓ |
| collection:read | ✓ | ✓ | ✓ | ✓ |
| collection:create | | ✓ | ✓ | ✓ |
| collection:update | | ✓ (propias) | ✓ | ✓ |
| collection:delete | | | ✓ | ✓ |
| user:read | | | | ✓ |
| user:create | | | | ✓ |
| user:update | | | | ✓ |
| user:delete | | | | ✓ |
| user:ban | | | | ✓ |

### Separación de vistas

```
/api/v1/*       → Vista pública (sin auth) — solo lectura
/api/admin/*    → Vista admin/editorial (auth + RBAC)
/api/auth/*     → Endpoints de autenticación (Better Auth handler)
```

El middleware de sesión se ejecuta en todas las rutas. Los guards de RBAC se aplican solo en `/api/admin/*`, verificando rol y permisos antes de ejecutar el handler.

## Consecuencias

### Positivas
* Modelo de permisos explícito, centralizado y versionable en un solo fichero.
* Separación clara entre vista pública y admin/editorial a nivel de rutas.
* Escalable: añadir nuevos roles o entidades es declarativo.
* Sin dependencias adicionales sobre las ya elegidas.

### Negativas / Riesgos
* Ownership ("author solo puede editar sus propios recursos") requiere lógica adicional en el handler, ya que `createAccessControl` no soporta condiciones por campo de forma nativa.
* Si los requisitos de permisos crecen mucho (multi-tenant, permisos por recurso individual), puede ser necesario migrar a CASL o similar.
* Acoplamiento al API de Better Auth admin plugin.

## Notas de Implementación

1. **Fichero de permisos**: `apps/api/src/auth/permissions.ts` — define statements, roles y access control.
2. **Middleware RBAC**: `apps/api/src/auth/middleware.ts` — factory `requireRole("curator")` y `requirePermission("resource", "curate")`.
3. **Ownership**: para acciones de author sobre sus propios recursos, el handler verifica `resource.authorId === session.userId` tras pasar el guard de rol.
4. **Rutas admin**: `apps/api/src/routes/admin.ts` — cada endpoint aplica el guard de permiso correspondiente.
5. **Rutas públicas**: `apps/api/src/routes/public.ts` — solo lectura, sin guards.

6. **Criterios de revisión**
   Reabrir esta decisión si:
   (a) Se necesitan permisos condicionales complejos (por campo, por tenant) de forma recurrente.
   (b) El frontend necesita evaluar permisos client-side de forma sofisticada (CASL sería más adecuado).
   (c) Se introducen más de 6 roles o políticas con herencia compleja.

## Actualización 2026-10-26 — borradores privados frente al curator (#460)

* Un borrador es trabajo privado de su autor. Un curator no ve ni gestiona borradores ajenos hasta que se envían a revisión: ni en el listado de Administrar (incluidos búsqueda y contadores del panel), ni en la ficha, ni por acceso directo a la API.
* El curator conserva el acceso a sus propios borradores y a los recursos ajenos en cualquier otro estado que ya podía ver (revisión, publicados, archivados). El admin lo ve todo.
* Si un curator devuelve un recurso ajeno de revisión a borrador, pierde el acceso aunque quede como curator asignado. Esto sustituye, solo para el estado `draft`, lo que se decidió en DEF-009 (#205); al publicar o archivar lo sigue conservando.
* La regla vive en un solo sitio, `packages/db/src/validation.ts`: `isOthersPrivateDraft`, `canViewResource` (lectura) y `canManageResource` (gestión). El listado aplica la misma regla en SQL (`listResources({ hideOthersDraftsFor })`) y las subidas la usan en `canManageResourceUpload`. El frontend importa las mismas funciones, así que el botón «Eliminar recurso» (#454) sigue la regla sin cambios.
* Las etiquetas de un recurso (`GET`/`PUT /api/admin/tags/resources/:id`) siguen la misma regla: la lectura usa `canViewResource` (404 a un borrador ajeno) y la escritura `canManageResource` (403). Antes cualquier curator las cambiaba en cualquier recurso.

## Actualización 2026-10-27 — colecciones de autores (#433)

* Las filas `collection:*` de la tabla de permisos por rol quedan precisadas por [ADR-0047](0047-colecciones-de-autores.md): author y editor crean colecciones de autor (públicas o privadas), editan y borran las suyas; curator y admin crean las editoriales; curator edita y borra las públicas ajenas que no están en borrador; las privadas solo las ven su propietario y el admin.
* La tabla anterior no se toca, pero en lo que respecta a colecciones manda ADR-0047. También sustituye a lo que hizo la feature de colecciones públicas (solo curator y admin).
* La comprobación de propiedad de las colecciones pasa a `packages/db/src/validation.ts` (`canViewCollection`, `canManageCollection`, `canTransitionCollection`), junto a la de los recursos.

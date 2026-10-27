# Requirements — Feature Colecciones de autores

## Fecha
2026-10-27

## Origen
Issue #433. Decisión de arquitectura en [ADR-0047](../../../../negocio/decisiones/0047-colecciones-de-autores.md).

## Problema público o educativo
Solo curator y admin pueden crear colecciones. Los docentes que publican recursos no pueden agruparlos ni compartir selecciones de recursos de otros, que es como más se reutiliza el material en el aula.

## Usuario principal beneficiado
- Autores y editores que quieren organizar recursos publicados en colecciones propias, públicas o privadas.
- Profesorado que descubre recursos a través de las colecciones de otros docentes.
- Curadores, que siguen manteniendo las colecciones editoriales y revisan las de autores.

## Decisiones de negocio (#433)
1. Una colección de autor puede incluir cualquier recurso publicado.
2. La colección pública de un author pasa por revisión; el autor la ve mientras tanto. Un editor la publica directamente.
3. El autor elige si es pública o privada.
4. Editan y borran el autor, el curator y el admin.
5. Las editoriales se distinguen de las de autores: etiqueta en la tarjeta, dos bloques en portada (editoriales primero), filtro por tipo en el listado. Las privadas solo las ven su autor y el admin.

## Datos mínimos necesarios
- Los de una colección actual (`title`, `slug`, `description`, `coverImageUrl`, `isOrdered`, `editorialStatus`).
- `kind` (`editorial` / `author`), `visibility` (`public` / `private`), `ownerId`.
- `reviewedBy`, `reviewedAt`, `publishedAt`.

## Requisitos funcionales
- RF-1: author y editor crean colecciones de autor, públicas o privadas, desde el backoffice.
- RF-2: author y editor solo añaden recursos publicados a sus colecciones.
- RF-3: flujo `draft → review → published` para las públicas de author; `draft → published` para las de editor; el curator aprueba o devuelve; curator y admin archivan.
- RF-4: las privadas no salen en portada, `/colecciones`, búsqueda, ficha de autor, feeds ni recomendaciones.
- RF-5: tarjeta con la etiqueta «Colección editorial» o «Colección de <autor>», enlazada a la ficha del autor (#458).
- RF-6: portada con dos bloques; filtro por tipo en `/colecciones`; bloque de colecciones en la ficha del autor.
- RF-7: `GET /api/admin/collections/:id/resources` solo devuelve los recursos que el usuario puede ver (`canViewResource`), con el número de ocultos.
- RF-8: las colecciones existentes pasan a editoriales y públicas sin cambiar su estado.
- RF-9: el curator no ve colecciones privadas ajenas ni colecciones ajenas en borrador.

## Requisitos no funcionales
- Reglas de permisos en un solo sitio (`packages/db/src/validation.ts`), compartidas por API y frontend.
- WCAG 2.1 AA: la etiqueta de tipo es texto, no solo color; los controles nuevos se manejan con teclado.
- Tests TypeScript por rol y estado; `bun run test` en verde.
- Sin dependencias nuevas.

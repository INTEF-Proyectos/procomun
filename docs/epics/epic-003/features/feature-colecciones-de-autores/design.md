# Design — Feature Colecciones de autores

## Fecha
2026-10-27

## Referencia
El diseño técnico completo (modelo de datos, matriz de permisos, visibilidad, migración, impacto en API y frontend, riesgos y preguntas abiertas) está en [ADR-0047](../../../../negocio/decisiones/0047-colecciones-de-autores.md). Aquí solo se resumen dependencias y capas.

## Dependencias
- #463 (regla `canViewResource` / `isOthersPrivateDraft`) en `main`.
- #458 (ficha de autor) para el enlace de la tarjeta y el bloque de la ficha. Si no está, la etiqueta sale sin enlace.

## Capas afectadas
- `packages/db`: esquema y migración de `collections` y `collection_resources`; reglas en `validation.ts`; repositorio con listados filtrados.
- `apps/api`: `routes/admin/collections.ts` (rol base, filtros, `PATCH /:id/status`, `/:id/resources`), `routes/public.ts` (`kind`, `ownerId`), `auth/permissions.ts`, `recommendations/service.ts` y feeds.
- `apps/frontend`: backoffice de colecciones para author y editor, cola de revisión, tarjeta, portada, `/colecciones`, ficha de autor, mensajes de Paraglide y ayuda.

## Impacto transversal
- Búsqueda y descubrimiento: más colecciones públicas; las recomendaciones solo cuentan colecciones públicas publicadas.
- Metadatos y curación: el curator revisa las colecciones de autores.
- Moderación: las denuncias de colecciones quedan como pregunta abierta.
- Privacidad: las privadas no se exponen en ningún listado ni señal agregada.

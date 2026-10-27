# Tasks — Feature Colecciones de autores

## Fecha
2026-10-27

## Estado
Pendiente: ADR-0047 propuesta, a la espera de que negocio responda a las preguntas abiertas.

## Documentación
- [x] ADR-0047 con modelo, permisos, visibilidad, migración, impacto y preguntas abiertas.
- [x] Secciones fechadas en ADR-0008 y ADR-0016 que remiten a ADR-0047.
- [ ] Respuestas de negocio a las preguntas abiertas (#433) y ADR-0047 en estado Aceptado.

## Implementación (con la ADR aceptada y #463 en `main`)
- [ ] Migración: `kind`, `visibility`, `owner_id`, `reviewed_by`, `reviewed_at`, `published_at`, estado `archived` y restricción única en `collection_resources`.
- [ ] `canViewCollection`, `canManageCollection`, `canTransitionCollection` y `COLLECTION_TRANSITION_RULES` en `packages/db/src/validation.ts`.
- [ ] Listados filtrados (`listCollections({ visibleTo })`, `listCollectionResources({ visibleTo })` con `hiddenCount`).
- [ ] API de administración: rol base `author`, `PATCH /:id/status`, `PATCH` sin `editorialStatus` ni `kind`, y author y editor solo añaden recursos publicados.
- [ ] API pública: `kind`, `ownerId`, `ownerName`; filtros `kind` y `ownerId`.
- [ ] Recomendaciones: solo colecciones públicas publicadas.
- [ ] Frontend: «Mis colecciones», visibilidad, enviar a revisión o publicar, cola de revisión, etiqueta de tipo, dos bloques en portada, filtro en `/colecciones` y bloque en la ficha del autor.
- [ ] Seed con colecciones de autor (en revisión, publicada y privada) y ayuda.

## Testing
- [ ] Tests de reglas por rol (author, editor, curator propietario, curator ajeno, admin) y por tipo, visibilidad y estado.
- [ ] Regresión de #463: un borrador ajeno en una colección no aparece para un curator en `/:id/resources`.
- [ ] API pública: las privadas y las no publicadas dan 404 y no salen en listados ni feeds.
- [ ] Frontend: etiqueta, filtro y bloques de portada.
- [ ] `bun run test` en verde.

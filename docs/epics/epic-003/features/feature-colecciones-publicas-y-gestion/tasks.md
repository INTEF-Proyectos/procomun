# Tasks — Feature Colecciones públicas y gestión editorial

## Fecha
2026-03-29

## Estado
Completado con desviación controlada en routing público

## Implementación
- [x] Exponer colecciones publicadas reales en la API pública con listado paginado y detalle por slug.
- [x] Ampliar el repositorio de datos con portada, curador, conteo de recursos y reordenación.
- [x] Elevar el permiso mínimo de gestión de colecciones a `curator`.
- [x] Sustituir los enlaces públicos placeholder por la sección `Colecciones`.
- [x] Crear la ruta pública `/colecciones` con búsqueda, paginación y vista de detalle navegable.
- [x] Añadir al backoffice campos de portada y descripción amplia para colecciones.
- [x] Añadir al backoffice la gestión de agregar, quitar y reordenar recursos asociados.
- [x] Sincronizar dashboard, sidebar y navegación compartida con el nuevo RBAC.

## Testing
- [x] Añadir cobertura TypeScript en `packages/db` para slug público y reordenación.
- [x] Añadir cobertura API para endpoints públicos y RBAC/admin de colecciones.
- [x] Añadir cobertura frontend para navegación pública y shell de colecciones.
- [x] Ejecutar `bun run test` en raíz y registrar resultado satisfactorio.
- [x] Ejecutar `cd apps/frontend && bun run build` y registrar resultado satisfactorio.

## Desviación documentada
- [x] El detalle público se expone dentro de `/colecciones?slug=...` en lugar de un path literal `/colecciones/:slug` por limitación del modo estático actual de Astro.

## Seguimiento 2026-05-25
- [x] Corregir el alcance de visibilidad RBAC para que `curator` vea y gestione también colecciones existentes creadas por otros perfiles editoriales.
- [x] Añadir regresión TypeScript en `apps/api/src/auth/roles.unit.test.ts` y `apps/api/src/routes/admin.unit.test.ts`.
- [x] Ejecutar `bun test` en raíz y verificar salida satisfactoria tras el ajuste.

## Riesgos abiertos 2026-05-25
- El backoffice de colecciones sigue sin diferenciar permisos finos entre "ver" y "gestionar"; el modelo actual concede gestión completa a `curator`, alineado con el defecto reportado, pero conviene formalizarlo en negocio si se necesita solo lectura parcial para algunos casos.

## Seguimiento 2026-11-03 — estado editorial validado (#486)
- [x] `validateCollection` (`packages/db/src/validation.ts`) rechaza un `editorialStatus` que no esté en `VALID_STATUSES` (`draft`, `review`, `published`, `archived`). El alta y el `PATCH /api/admin/collections/:id` responden 400 y la colección no cambia.
- [x] Regresión rojo → verde en `apps/api/src/resources/validation.unit.test.ts` y `apps/api/src/routes/admin.unit.test.ts`.
- [x] Ejecutar `bun run test` y `bun run check-types` en raíz con salida satisfactoria.

## Riesgos abiertos 2026-11-03
- La columna `collections.editorial_status` sigue sin `CHECK` en la base de datos, igual que la de los recursos: la validación vive en la API. Una fila con un estado inventado guardada antes del arreglo da 400 en cualquier `PATCH` hasta que se le asigne un estado válido (el formulario de edición siempre lo envía).
- Las reglas de transición por rol de las colecciones quedan fuera: desde #433 solo las crean admin y curator.

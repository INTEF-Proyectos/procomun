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

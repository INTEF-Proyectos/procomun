# Tareas: DESIGN.md como contrato de diseno

## Tareas iniciales

- [x] Analizar especificacion oficial de Stitch/Google Labs y documentacion via Context7.
- [x] Revisar `VoltAgent/awesome-design-md` para extraer ideas de estructura, previews y guia para agentes.
- [x] Revisar `getdesign.md` para extraer ideas de catalogacion, categorias, tarjetas y previews de contratos.
- [x] Revisar tokens y componentes existentes en `apps/frontend/src/styles/design-tokens.css` y `apps/frontend/src/ui/`.
- [x] Crear ADR desde `.templates/adr-template.md`.
- [x] Crear `DESIGN.md` raiz con tokens y guia de uso.
- [x] Crear script de validacion `scripts/check-design-md.ts`.
- [x] Crear test unitario asociado `scripts/check-design-md.unit.test.ts`.
- [x] Anadir comando `bun run design:lint`.
- [x] Ejecutar validacion automatizada.
- [x] Actualizar `status.yaml` sin borrar historial.

## Actualizacion 2026-04-24

La feature queda completada como contrato derivado y validado. Quedan fuera de alcance la generacion automatica de CSS desde `DESIGN.md` y la incorporacion del CLI oficial como dependencia obligatoria.

Se incorporan ideas de `awesome-design-md` como patrones documentales: secciones de profundidad/elevacion, responsive y guia de prompt para agentes. La creacion de previews visuales `preview.html` y `preview-dark.html` queda anotada como mejora futura.

Se incorpora `getdesign.md` como referencia de descubrimiento: si Procomun necesita exponer contratos visuales internos, conviene hacerlo con metadatos, categorias, previews y fecha de actualizacion.

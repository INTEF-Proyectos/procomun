# Feature: DESIGN.md como contrato de diseno

## Estado

Completada el 2026-04-24.

## Problema publico o educativo

Procomun debe crecer con nuevas pantallas de descubrimiento, ficha de recurso, colecciones, curacion y backoffice sin perder consistencia visual ni accesibilidad. Cuando distintas tareas IA modifican la interfaz, aumenta el riesgo de introducir colores, espaciados, componentes o patrones que dificultan la reutilizacion y la lectura del catalogo educativo.

## Usuario principal beneficiado

* Profesorado y ciudadania que buscan recursos: reciben una experiencia mas consistente y predecible.
* Equipo editorial y de curacion: trabaja con interfaces mas homogeneas.
* Agentes y personas desarrolladoras: disponen de un contrato explicito antes de modificar UI.

## Objetivos

* Documentar la identidad visual y reglas de UI de Procomun en un `DESIGN.md` raiz.
* Mantener coherencia con `apps/frontend/src/styles/design-tokens.css`.
* Definir una validacion automatizada minima para detectar drift de tokens criticos.
* Registrar la decision mediante ADR por depender de una especificacion externa en estado `alpha`.
* Incorporar ideas utiles de `VoltAgent/awesome-design-md` sin copiar identidades visuales de terceros.
* Anotar `getdesign.md` como referencia de descubrimiento, categorias y previews para una posible documentacion visual futura.

## Alcance

Incluido:

* ADR-0022.
* `DESIGN.md` raiz con YAML front matter y guia Markdown.
* Script `bun run design:lint`.
* Test unitario de la validacion.
* Documentacion de diseno, tareas y validacion.
* Notas de inspiracion tomadas de `awesome-design-md`: secciones extendidas, previews visuales y guia rapida para agentes.
* Notas de inspiracion tomadas de `getdesign.md`: coleccion categorizada, tarjetas de direccion visual y metadatos de actualizacion.

No incluido:

* Migrar la fuente de verdad desde CSS a `DESIGN.md`.
* Generar tokens CSS automaticamente desde el contrato.
* Incorporar `@google/design.md` como dependencia obligatoria.
* Redisenar componentes existentes.
* Crear `preview.html` o `preview-dark.html` en esta iteracion.
* Crear una pagina `/dev/design` o catalogo visual interno.

## Datos minimos necesarios

* Tokens de color, tipografia, espaciado y radio ya existentes.
* Componentes base del sistema UI.
* Reglas de accesibilidad y patrones de layout.
* Estado `alpha` de la especificacion externa.

## Impacto transversal

* Accesibilidad: explicita contraste, foco, estados de error y objetivos tactiles.
* Rendimiento: no introduce runtime de frontend.
* Seguridad y privacidad: sin impacto directo.
* Trazabilidad: ADR, feature docs, `status.yaml` y contrato raiz.
* Mantenibilidad: reduce drift visual y hace revisables los cambios futuros.
* Interoperabilidad: permite compartir un contrato de diseno con Stitch u otros agentes.
* Calidad de metadato y busqueda: refuerza patrones de facetas, fichas y lectura editorial.

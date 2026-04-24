# ADR-0022: DESIGN.md como contrato de diseno para agentes IA

* Estado: Aceptado
* Fecha: 2026-04-24
* Agentes Implicados: [@.agents/skills/evaluacion-tecnologica, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/documentacion-y-roadmap]

## Contexto y Problema

Procomun ya dispone de un sistema de diseno operativo en `apps/frontend/src/styles/design-tokens.css` y de componentes React en `apps/frontend/src/ui/`. Sin embargo, las tareas ejecutadas por agentes IA no tenian un contrato raiz, legible por humanos y maquinas, que explicara la direccion visual, los tokens autorizados y las restricciones de accesibilidad antes de crear o modificar pantallas.

Google Labs ha publicado `DESIGN.md`, usado por Stitch, como especificacion para combinar tokens de diseno en YAML front matter con una guia Markdown. La documentacion oficial y Context7 describen el formato como `alpha`, con campos como `version`, `name`, `description`, `colors`, `typography`, `rounded`, `spacing` y `components`, y un CLI/API para lint, diff y exportacion.

Tambien se revisa `VoltAgent/awesome-design-md` como repositorio de referencia de patrones. Sus ejemplos proponen secciones extendidas utiles para agentes: tema visual y atmosfera, roles de color, reglas tipograficas, estilos de componentes, principios de layout, profundidad/elevacion, do/don'ts, comportamiento responsive y guia rapida de prompt para agentes. Tambien documenta previews visuales (`preview.html` y `preview-dark.html`) como posible mejora futura.

Se revisa ademas `getdesign.md`, escaparate publico de esa coleccion. A fecha 2026-04-24 muestra 69 ficheros `DESIGN.md`, categorias por tipo de producto y tarjetas de descubrimiento con descripciones breves de direccion visual. Para Procomun aporta ideas de catalogacion, taxonomia y previsualizacion de contratos de diseno, no tokens ni estilos concretos.

La decision afecta al flujo de trabajo de frontend y a la trazabilidad documental, pero no debe introducir una doble fuente de verdad incontrolada ni sustituir los componentes existentes.

## Opciones Consideradas

* No adoptar `DESIGN.md` y mantener solo `design-tokens.css`
* Adoptar `DESIGN.md` como fuente de verdad primaria y generar CSS desde el contrato
* Adoptar `DESIGN.md` como contrato derivado y validado, sincronizado con los tokens CSS actuales
* Incorporar ademas una galeria visual tipo `preview.html` inspirada en `awesome-design-md`
* Crear un indice navegable de contratos y previews al estilo `getdesign.md`

## Decisión

Se adopta `DESIGN.md` como contrato derivado y validado del sistema de diseno existente.

La fuente operativa de estilos sigue siendo `apps/frontend/src/styles/design-tokens.css` junto con los componentes de `apps/frontend/src/ui/`. El nuevo `DESIGN.md` documenta esos tokens, la intencion visual y las reglas de uso para agentes IA, prototipado y revisiones de UI.

La integracion inicial usa una validacion propia en TypeScript (`bun run design:lint`) para comprobar la estructura minima y la sincronizacion de tokens criticos. El CLI oficial de `@google/design.md` queda documentado como validacion complementaria, pero no se incorpora todavia como dependencia obligatoria porque la especificacion sigue en `alpha`.

Se toman ideas estructurales de `awesome-design-md`, pero no se copian identidades visuales ni tokens de marcas de terceros. Procomun mantiene su propia direccion visual, ya expresada en `design-tokens.css`.

`getdesign.md` queda registrado como referencia para una posible experiencia futura de documentacion visual: tarjetas, categorias, previews y filtros para explorar variantes de diseño internas del proyecto.

## Consecuencias

### Positivas

* Los agentes disponen de un contrato claro antes de modificar frontend.
* Se reduce la probabilidad de introducir colores, espaciados o patrones visuales ad hoc.
* La direccion visual queda trazada junto a la ADR y la feature documental.
* La validacion automatizada detecta drift basico entre `DESIGN.md` y `design-tokens.css`.
* La adopcion es reversible si el formato cambia durante su etapa `alpha`.
* Las secciones extendidas facilitan que futuros agentes entiendan densidad, responsive, elevacion y anti-patrones sin inferirlos desde CSS.
* Las referencias a `getdesign.md` ayudan a pensar el contrato como recurso catalogable y previsualizable, coherente con el propio dominio de Procomun.

### Negativas / Riesgos

* Existe riesgo de divergencia si se cambian tokens CSS sin actualizar `DESIGN.md`.
* La validacion local no sustituye por completo al CLI oficial.
* El formato puede cambiar en futuras versiones de `@google/design.md`.
* Mantener el contrato anade una tarea documental a cualquier cambio relevante de UI.
* Las referencias a `awesome-design-md` son inspiracion metodologica; copiar estilos de marcas externas introduciria riesgo legal y de identidad.

## Notas de Implementación

* Crear `DESIGN.md` en la raiz del repositorio con front matter compatible con la especificacion `alpha`.
* Anadir `scripts/check-design-md.ts` y su test unitario asociado.
* Exponer `bun run design:lint` en `package.json`.
* Documentar la feature en `docs/epics/epic-003/features/feature-design-md-contrato-diseno/`.
* Reabrir esta ADR si `@google/design.md` estabiliza una version no `alpha`, si se decide generar CSS desde `DESIGN.md`, o si el CLI oficial pasa a ser dependencia obligatoria de CI.
* Evaluar en una iteracion posterior si conviene anadir una galeria `design-preview.html` propia con muestras de color, tipografia, botones, cards, estados y modo oscuro.
* Si Procomun llega a tener varios contratos visuales, valorar una pagina interna tipo `/dev/design` con categorias, previews y estado de validacion.

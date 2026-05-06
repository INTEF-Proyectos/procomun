# Diseno tecnico: DESIGN.md como contrato de diseno

## Contexto

La Epic-003 consolido el rediseño publico y editorial de Procomun mediante tokens CSS y componentes React. El nuevo contrato `DESIGN.md` formaliza ese sistema para agentes IA y herramientas externas sin sustituir la implementacion actual.

## Arquitectura propuesta

```text
DESIGN.md
  contrato humano + maquina
  |
  | validacion propia
  v
scripts/check-design-md.ts
  compara estructura minima y tokens criticos
  |
  v
apps/frontend/src/styles/design-tokens.css
  fuente operativa actual de estilos
```

## Fuente de verdad

En esta iteracion:

* `design-tokens.css` sigue siendo la fuente operativa de estilos.
* `DESIGN.md` es un contrato derivado y versionado.
* `scripts/check-design-md.ts` detecta divergencia en tokens criticos.

La ADR-0022 deja abierta la posibilidad de invertir el flujo si la especificacion `DESIGN.md` madura y el CLI oficial resulta estable para CI.

## Estructura de DESIGN.md

El fichero incluye:

* YAML front matter con `version: alpha`.
* Nombre y descripcion del sistema.
* Tokens de `colors`, `typography`, `rounded`, `spacing`.
* Componentes base: botones, inputs, chips, cards y navegacion.
* Guia Markdown con overview, colores, tipografia, layout, componentes, accesibilidad, do/don'ts.
* Secciones extendidas inspiradas por `awesome-design-md`: profundidad/elevacion, comportamiento responsive y guia rapida para agentes.

## Referencia awesome-design-md

`VoltAgent/awesome-design-md` recopila contratos `DESIGN.md` inspirados en sitios publicos y propone que cada contrato incluya:

* tema visual y atmosfera;
* paleta y roles semanticos de color;
* reglas tipograficas;
* estilos de componentes y estados;
* principios de layout;
* profundidad y elevacion;
* do/don'ts;
* comportamiento responsive;
* guia de prompt para agentes.

Tambien acompana cada contrato con `preview.html` y `preview-dark.html` para mostrar swatches, escala tipografica, botones, cards, espaciado y radios. En Procomun esta idea queda como mejora futura, porque esta feature prioriza el contrato raiz y la validacion automatizada.

La referencia se usa como patron documental, no como fuente de tokens ni de identidad visual.

## Referencia getdesign.md

`getdesign.md` funciona como escaparate de la coleccion `awesome-design-md`. En la revision del 2026-04-24 muestra:

* 69 ficheros `DESIGN.md`;
* categorias por dominio: plataformas IA, herramientas de desarrollo, backend/devops, SaaS, diseno, fintech, ecommerce, media y automocion;
* tarjetas con nombre, descripcion breve de direccion visual y estado;
* enlaces a disenos destacados;
* orientacion de uso: tomar un `DESIGN.md` como inspiracion para que agentes generen UI consistente.

Para Procomun la idea reutilizable no es copiar ningun estilo, sino tratar el contrato de diseno como un recurso catalogable: con metadatos, fecha de actualizacion, categoria, preview y estado de validacion. Si en el futuro hay variantes visuales para backoffice, portal publico, campañas o laboratorios, podria tener sentido una pagina interna `/dev/design` inspirada en ese modelo.

## Validacion

El script local:

* extrae front matter;
* parsea un subconjunto simple de YAML suficiente para el contrato actual;
* valida campos obligatorios;
* valida tokens de color y componentes minimos;
* extrae custom properties CSS;
* compara tokens criticos entre `DESIGN.md` y `design-tokens.css`.

Esta validacion evita anadir dependencias nuevas y funciona con Bun. El CLI oficial `npx @google/design.md lint DESIGN.md` se mantiene como comprobacion complementaria documentada porque la especificacion sigue en `alpha`.

## Integracion con agentes

Las futuras tareas de frontend deben consultar `DESIGN.md` antes de introducir UI nueva. Si una tarea requiere tokens o variantes no presentes:

1. Actualizar `design-tokens.css`.
2. Actualizar `DESIGN.md`.
3. Ejecutar `bun run design:lint`.
4. Ejecutar `bun test`.
5. Registrar ADR si el cambio altera direccion visual, tecnologia o fuente de verdad.

## Riesgos

* El parser local no pretende cubrir YAML completo.
* El CLI oficial puede cambiar el esquema esperado.
* El contrato puede quedar obsoleto si se modifican componentes sin actualizarlo.
* La adopcion como artefacto derivado exige disciplina documental, pero evita lock-in prematuro.
* Copiar estilos de marcas externas no es aceptable para Procomun; las referencias solo sirven para estructura y buenas practicas.
* Una galeria interna de contratos seria util solo si no duplica la documentacion existente ni convierte el design system en una coleccion de variantes inconsistentes.

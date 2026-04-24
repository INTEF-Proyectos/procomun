# Validacion: DESIGN.md como contrato de diseno

## Comandos requeridos

```bash
bun run design:lint
bun test
```

## Resultado esperado

* `bun run design:lint` debe confirmar que `DESIGN.md` mantiene la estructura minima y que tokens criticos coinciden con `design-tokens.css`.
* `bun test` debe ejecutar la suite estandar del repositorio, incluyendo el test unitario nuevo de `scripts/check-design-md.ts`.

## Validacion oficial complementaria

La documentacion de Google Labs indica que el CLI oficial permite:

```bash
npx @google/design.md lint DESIGN.md
npx @google/design.md diff DESIGN.md DESIGN-v2.md
npx @google/design.md export --format tailwind DESIGN.md
npx @google/design.md export --format dtcg DESIGN.md
```

Esta feature no incorpora todavia `@google/design.md` como dependencia fija porque la especificacion esta en estado `alpha`. La comprobacion oficial puede ejecutarse bajo demanda y deberia reevaluarse cuando exista una version estable del formato.

## Validacion de referencias externas

Se reviso `VoltAgent/awesome-design-md` como referencia metodologica. Las ideas trasladadas a Procomun son estructurales:

* secciones extendidas para agentes;
* documentacion de profundidad/elevacion;
* comportamiento responsive;
* guia rapida de prompt;
* posible galeria visual futura.

No se copiaron tokens, marcas ni identidades visuales de terceros.

Se reviso tambien `getdesign.md` como escaparate publico de la coleccion. Las ideas anotadas son:

* categorias de contratos por tipo de producto;
* tarjetas resumidas de direccion visual;
* metadatos de cantidad y fecha de actualizacion;
* posible pagina interna futura para previsualizar el contrato de Procomun.

Tampoco se copiaron estilos ni materiales de marca desde `getdesign.md`.

## Riesgos residuales

* El validador local cubre el contrato actual, no todo YAML.
* El CLI oficial puede reportar advertencias adicionales no cubiertas por la validacion local.
* Si se cambian tokens CSS sin tocar `DESIGN.md`, la validacion solo detectara drift en los tokens criticos incluidos en el mapa.

# Resolucion de conflictos del PR #471

## 2026-11-03: alcance y contrato

Integrar main en la rama de #409 para desbloquear las miniaturas educativas sin
perder el acceso seguro a los borradores introducido por #483. Se conserva el
stack existente y el contrato combinado: buildElpxPreview admite hasScreenshot
y estado editorial, y devuelve hash, previewUrl y screenshotUrl. Los recursos
publicados conservan su URL estable; los demas usan una URL firmada tambien para
screenshot.png. Sin captura, screenshotUrl es null.

El repositorio conserva getElpxResourceStatusByHash, la consulta de proyectos
para el relleno de capturas y su actualizacion. No cambia el modelo de metadatos,
el ranking ni las reglas de moderacion. No se introduce tecnologia ni dependencia
nueva; se mantienen las decisiones de acceso de ADR-0026.

## Validacion

- 29 pruebas especificas correctas de vistas previas, tokens, acceso al contenido
  y persistencia de capturas.
- Nuevas pruebas de miniaturas publicadas, borradores, recursos en revision,
  archivados, estado null y ausencia de captura; verifican la firma del token.
- bun run check-types: 0 errores.
- Suite completa y controles finales pendientes.

## 2026-11-03: journal heredado de un merge anterior

El lint detecto dos claves when y tag en la entrada idx 12: al parsearla,
0015_elpx_has_screenshot desaparecia. Se conserva 0014_knowledge_areas tal
como esta en main y se registra 0015 por separado con idx 13 y when posterior.
Se adapta la prueba de 0014 para comparar solo las migraciones anteriores y
se a?ade una regresion que comprueba ambas entradas. Las 16 pruebas del archivo
de migraciones pasan. Lint y check-tracking pasan con avisos preexistentes.

## 2026-11-03: ajustes detectados por la suite completa

La primera ejecucion encontro seis fallos: dos del journal ya corregido, uno
en la captura de ayuda del CLI (dos comandos se pasaban al mismo log.log) y
tres de un fixture legacy sin recurso publicado. Se separan las lineas de
ayuda y se prueba que cada comando registrado aparece. El fixture legacy se
registra con seedPublishedElpxHash igual que el resto de paquetes publicos,
sin relajar la autorizacion. Los 19 tests del CLI y de servido pasan.
Los tipos y el lint vuelven a pasar. Se repite la suite completa tras los ajustes.

## 2026-11-03: resultado final

- bun run test: correcto (1314 unitarias, 22 de integracion, 83 de interfaz).
- Reejecucion instrumentada: 1336 pruebas correctas, 0 fallos.
- Cobertura de lineas: 91,62 %, superior al umbral del 90 %.
- bun run check-types: 0 errores.
- bun run lint y check-tracking: correctos, con avisos preexistentes.
- No se ejecutaron pruebas e2e. Se mantienen los permisos de recursos privados.
- Resolucion lista para revision del PR; sin nuevas decisiones de arquitectura.

## 2026-11-03: revisión, miniatura sin visor HTML

La revisión encontró que `buildElpxPreview` devolvía `null` si el paquete no
tenía `index.html`, aunque trajera `screenshot.png` en la raíz. El procesador
admite esos paquetes y calcula `hasPreview` y `hasScreenshot` por separado, así
que la tarjeta perdía la miniatura y caía al marcador del tipo.

Cambio de contrato: `elpxPreview` existe si hay visor o miniatura, y solo es
`null` si no hay ninguno de los dos. `previewUrl` pasa a ser `string | null`
(`null` = sin visor) en la API (`ElpxPreview`) y en el frontend
(`ElpxCardPreview`). Que `elpxPreview` no sea `null` ya no implica que haya
visor: el iframe de la ficha, «Ver en línea», «Ponlo en tu web» y el iframe de
reserva de la tarjeta dependen de `previewUrl`. La miniatura cuelga del mismo
prefijo que el visor: URL estable si está publicado y enlace firmado si no
(#466, #483).

Consumidores revisados: tarjetas (`resourceCardMedia`, `ResourceCard`, portada,
catálogo, colecciones, recomendados), ficha (`ResourceDetailIsland` y el relay
de embeds), «Ponlo en tu web», edición (`EditarPageBase` y
`/api/admin/resources/:id/elpx`, que ya daban `previewUrl: null` sin
`index.html`) y los e2e del `.elpx`. Solo la ficha necesitaba un ajuste: el
relay de embeds recibe ahora el `previewUrl` ya derivado.

Pruebas nuevas (rojo → verde): 5 de `buildElpxPreview` (publicado y cuatro
estados no publicados, con el token verificado) y 3 de la API (ficha, listado
y miniatura firmada de un borrador, servida sin cookies). En el frontend, el
tipo con `previewUrl: null` daba 5 errores de tipos antes del cambio. Además,
pruebas de caracterización del procesador (sin `index.html`, con captura), de
la ruta (la captura se sirve y la URL del visor da 404), de la edición, de la
tarjeta (imagen sin iframe) y de la ficha (sin visor ni «Ponlo en tu web»).

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

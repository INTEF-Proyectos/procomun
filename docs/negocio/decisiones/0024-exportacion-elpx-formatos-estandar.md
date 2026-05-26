# ADR-0024 Exportación de .elpx a formatos estándar mediante bundle de eXeLearning en navegador

* Estado: Aceptado
* Fecha: 2026-05-26
* Agentes Implicados: [@.agents/skills/interoperabilidad-educativa, @.agents/skills/backend-api-servicios, @.agents/skills/evaluacion-tecnologica]

## Contexto y Problema

Los recursos educativos en formato `.elpx` almacenados en Procomún solo pueden descargarse en su formato nativo. Los docentes necesitan exportar a SCORM 1.2, SCORM 2004, IMS Content Package, HTML5 (web) y EPUB3 para poder reutilizarlos en LMS (Moodle, Canvas, Blackboard), publicación web directa o lectura offline (Kindle, iBooks).

Actualmente, el flujo requiere que el usuario descargue el `.elpx`, abra eXeLearning desktop, importe, exporte y vuelva a Procomún. Esto genera fricción, versiones desactualizadas y excluye a usuarios sin eXeLearning instalado (tablets, Chromebooks).

## Opciones Consideradas

* **Opción A: Extender el bridge postMessage del editor iframe (WP_REQUEST_EXPORT)**
  - Reutiliza `SharedExporters` del editor embebido.
  - Requiere que el editor esté abierto en iframe para ejecutar la exportación.
  - El usuario debe estar en la pantalla de edición para exportar.

* **Opción B: Cargar el bundle `exporters.bundle.js` directamente en la plataforma (sin iframe editor)**
  - El bundle IIFE de eXeLearning (`public/app/yjs/exporters.bundle.js`) expone `window.SharedExporters` con `quickExport()` y todos los exportadores.
  - La plataforma carga el bundle JS en la ficha de recurso o en un contexto dedicado.
  - Se crea un `DocumentAdapter` mínimo que alimenta los exportadores con los datos del `.elpx` ya almacenado (content.xml + assets extraídos).
  - La exportación ocurre íntegramente en el navegador del usuario, sin servidor.
  - No requiere tener el editor iframe abierto.

* **Opción C: API HTTP de eXeLearning como servicio Docker**
  - Exportación en servidor.
  - Añade servicio adicional al docker-compose.
  - Mayor coste operacional y complejidad de despliegue.

* **Opción D: Implementación propia de generadores SCORM/IMS/EPUB en TypeScript**
  - Control total pero coste altísimo.
  - Riesgo de incompatibilidad con LMS reales.
  - Duplica lógica ya probada en eXeLearning.

## Decisión

Se adopta la **Opción B**: cargar el bundle `exporters.bundle.js` de eXeLearning directamente en la plataforma y utilizar `window.SharedExporters.quickExport()` para generar exportaciones en el navegador sin necesidad del editor completo.

**Justificación principal:**

1. **Cero carga en servidor**: la exportación ocurre en el navegador usando el bundle JS optimizado de eXeLearning. Cada llamada genera la exportación en caliente.
2. **Reutilización máxima**: el bundle ya incluye todos los exportadores (SCORM 1.2/2004, IMS CP, HTML5, HTML5 single-page, EPUB3) probados y certificados por eXeLearning.
3. **Independencia del editor**: no requiere tener el iframe del editor abierto. Se puede exportar desde la ficha de recurso, desde el listado o programáticamente.
4. **Bajo acoplamiento**: el adaptador (`ElpxDocumentAdapter`) traduce los datos extraídos del `.elpx` almacenado al formato que esperan los exportadores, aislando a Procomún de cambios internos de eXeLearning.
5. **Compatible con la arquitectura actual**: se sirve el bundle como asset estático desde la misma ruta que ya sirve el editor (`/api/v1/exelearning-editor/`).

**Formatos soportados:**

| Formato | ID del exportador | Extensión salida |
|---|---|---|
| SCORM 1.2 | `scorm12` | `.zip` |
| SCORM 2004 | `scorm2004` | `.zip` |
| IMS Content Package | `ims` | `.zip` |
| HTML5 (multi-página) | `html5` | `.zip` |
| HTML5 (single page) | `html5-sp` | `.zip` |
| EPUB3 | `epub3` | `.epub` |

## Consecuencias

### Positivas
* Un solo clic en la ficha de recurso genera el paquete listo para LMS.
* Usuarios sin eXeLearning instalado pueden exportar a cualquier formato.
* No añade servicios ni complejidad al despliegue (exportación 100% client-side).
* Consistencia: exporta siempre la versión guardada en Procomún.
* Reutiliza toda la lógica de exportación nativa de eXeLearning sin re-implementar.
* Permite futuras mejoras (exportación por lotes con Web Worker, pre-generación con Service Worker).

### Negativas / Riesgos
* La API de `SharedExporters` no está documentada públicamente y puede cambiar entre versiones de eXeLearning. Riesgo: medio (mitiga el adaptador intermedio).
* El bundle `exporters.bundle.js` puede ser pesado (~200-500KB). Se carga bajo demanda (lazy load) solo cuando el usuario solicita una exportación.
* La exportación EPUB de recursos muy grandes puede ser lenta en dispositivos con poca memoria. Riesgo: bajo (se puede mostrar progreso).
* Dependencia de la distribución del bundle de eXeLearning junto al editor estático.

## Notas de Implementación

### Arquitectura del flujo de exportación

```
┌─────────────────────────────────────────────────────────────┐
│  Navegador del usuario                                       │
│                                                              │
│  1. Usuario pulsa "Exportar a SCORM 1.2"                     │
│  2. Se carga (lazy) exporters.bundle.js                      │
│     → window.SharedExporters disponible                      │
│  3. Se descarga el .elpx del recurso (/api/.../content)      │
│  4. ElpxDocumentAdapter parsea content.xml + assets           │
│  5. SharedExporters.quickExport('scorm12', adapter, ...)     │
│  6. Se recibe ExportResult { data: Uint8Array, filename }    │
│  7. Se ofrece como descarga al usuario (saveAs / <a>)        │
└─────────────────────────────────────────────────────────────┘
```

### Archivos a crear/modificar

1. `apps/frontend/src/lib/elpx-export.ts` — Servicio de exportación client-side:
   - Carga lazy del bundle `exporters.bundle.js`.
   - `ElpxDocumentAdapter`: adapta content.xml extraído al interfaz `YjsDocumentManagerLike`.
   - `ElpxResourceFetcher`: sirve assets del .elpx extraído como si fueran recursos temáticos.
   - Función `exportElpx(format, elpxUrl)`: orquesta descarga → adaptación → export → download.

2. `apps/frontend/src/lib/elpx-export.unit.test.ts` — Tests unitarios del servicio.

3. Extensión del bridge en `apps/api/src/routes/exelearning-editor.ts`:
   - Nuevo mensaje `WP_REQUEST_EXPORT` que delega en `SharedExporters.quickExport()` con formato configurable.
   - Respuesta `WP_EXPORT_FILE` con bytes + filename + mimeType.

4. `apps/api/src/routes/exelearning-editor.unit.test.ts` — Tests del nuevo mensaje del bridge.

### Dependencias externas

- Ninguna nueva dependencia npm/bun. El bundle `exporters.bundle.js` se distribuye como asset estático junto al editor de eXeLearning (ya descargado con `make download-exelearning-editor`).

### Siguientes pasos

- Implementar `elpx-export.ts` con lazy loading y adaptadores.
- Extender bridge script para soportar `WP_REQUEST_EXPORT`.
- Crear componente UI "Exportar" en la ficha de recurso (feature futura, fuera de esta ADR).
- Documentar en el roadmap la disponibilidad del botón de exportación por rol.

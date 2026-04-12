# ADR-0020 Generación especializada de `.elpx` para media homogénea en subidas manuales

* Estado: Aceptado
* Fecha: 2026-04-12
* Agentes Implicados: [@.agents/skills/documentacion-y-roadmap, @.agents/skills/arquitectura-solucion, @.agents/skills/backend-api-servicios, @.agents/skills/frontend-ux-accesibilidad]

## Contexto y Problema

La implementación actual soporta dos caminos para asociar contenido a un recurso:

* subida nativa de un archivo `.elpx`
* subida manual de adjuntos, que posteriormente se empaquetan automáticamente como un `.elpx`

En el flujo manual, el endpoint `POST /api/admin/elpx/generate/:resourceId` genera hoy un `.elpx` genérico con `content.xml`, `index.html` y todos los adjuntos en la raíz del ZIP. Esta solución es válida como fallback, pero no aprovecha el caso en que todos los adjuntos pertenecen a una misma familia de media renderizable.

Además, cualquier cambio en este comportamiento debe preservar un requisito funcional clave: cada archivo subido manualmente debe seguir existiendo como media reutilizable y enlazable de forma directa, sin quedar absorbido exclusivamente por el `.elpx` generado.

## Opciones Consideradas

* Mantener siempre el `.elpx` genérico actual.
* Especializar el `.elpx` generado cuando los adjuntos manuales sean homogéneos por tipo de media, preservando URLs directas por archivo.
* Dejar de generar `.elpx` automáticamente en el flujo manual y exponer solo los archivos originales.

## Decisión

Se propone adoptar la segunda opción:

* cuando todos los adjuntos manuales de un recurso sean `image/*`, `audio/*` o `video/*`, generar un `.elpx` especializado para ese tipo;
* distinguir explícitamente entre cardinalidad `1` y `N`;
* mantener el `.elpx` genérico actual como fallback para combinaciones mixtas o no soportadas;
* preservar siempre los `media_items` y sus URLs directas como contrato estable de reutilización.

Comportamiento propuesto:

1. Imágenes
   * una imagen: `.elpx` que la muestre directamente
   * varias imágenes: `.elpx` con galería
2. Audios
   * un audio: `.elpx` con reproductor individual
   * varios audios: `.elpx` con listado o galería reproducible
3. Vídeos
   * un vídeo: `.elpx` con reproductor individual
   * varios vídeos: `.elpx` con listado o galería de vídeo
4. Casos mixtos o no clasificados
   * `.elpx` genérico con índice y enlaces, como en la implementación actual

Esta ADR se acepta porque cierra una decisión de contrato editorial y de experiencia de reutilización que afecta tanto al generador automático de `.elpx` como a la preservación de URLs directas por `media_item`.

## Consecuencias

### Positivas
* Mejora la utilidad editorial del flujo manual sin exigir al usuario crear un `.elpx` nativo desde fuera.
* Aprovecha mejor el contenido homogéneo de imagen, audio y vídeo.
* Conserva la compatibilidad con el pipeline actual de `elpx_project`, preview y edición.
* Preserva la reutilización individual de los binarios subidos a través de URLs directas.

### Negativas / Riesgos
* Introduce lógica adicional de clasificación por MIME/type y selección de plantilla.
* Exige definir claramente qué tipos de archivo se consideran renderizables en v1.
* Puede generar expectativas de maquetación más rica de las que el generador actual soporta.
* Requiere validación de accesibilidad y compatibilidad del `.elpx` especializado con eXeLearning y el preview actual.

## Notas de Implementación

1. La implementación debe afectar solo al flujo manual de generación automática; la subida nativa de `.elpx` se mantiene sin cambios.
2. El punto de extensión natural es `generateElpxFromFiles`, bien evolucionándolo, bien sustituyéndolo por una selección de plantillas por tipo de media.
3. Los `media_items` no deben eliminarse ni esconderse por el hecho de existir un `.elpx` derivado.
4. La validación mínima de la futura implementación debe cubrir:
   * clasificación homogénea por `image/*`, `audio/*`, `video/*`
   * cardinalidad `1` y `N`
   * fallback mixto
   * persistencia de URLs directas por `media_item`
   * compatibilidad con `processElpxUpload`
5. La implementación debe abrirse como feature derivada de la épica 002 con tests automatizados de generación y postproceso.

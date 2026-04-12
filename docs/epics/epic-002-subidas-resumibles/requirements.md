# Requirements — Épica 002: subidas resumibles y adjuntos de recursos

## Fecha
2026-03-27

## Problema público/educativo
Los recursos educativos reales suelen incluir vídeos, paquetes SCORM, presentaciones o datasets de gran tamaño. Sin un sistema de subida robusto, la plataforma no puede servir como herramienta editorial útil para autores y curadores.

## Usuario principal
- Autor/editor que necesita adjuntar archivos pesados a un recurso sin perder trabajo ante cortes de red.

## Objetivo de la épica
Entregar una primera capacidad end-to-end de subida multiarchivo resumable con progreso, cancelación y adjuntos persistidos en recursos.

## Requisitos funcionales mínimos
- RF-001: crear una sesión de upload autenticada para un recurso editable por el usuario.
- RF-002: reanudar uploads interrumpidos sin reiniciar desde cero.
- RF-003: subir varios archivos en paralelo con progreso individual y global.
- RF-004: cancelar un archivo sin afectar al resto del lote.
- RF-005: persistir el binario y asociarlo a `media_items` al completar.
- RF-006: listar uploads recientes y archivos adjuntos desde la edición del recurso.

## Requisitos no funcionales
- Seguridad: sesión + RBAC + allow-list de extensiones/MIME.
- Rendimiento: streaming sin cargar el archivo completo en memoria.
- Accesibilidad: dropzone usable por teclado y mensajes con `aria-live`.
- Operación: límites configurables por entorno y storage local parametrizable.

## Fuera de alcance (esta entrega)
- Object storage S3-compatible en producción.
- Escaneo de malware obligatorio.
- Publicación pública de binarios fuera del backoffice.

## Actualización 2026-04-12 — propuesta ADR-0020

### Problema adicional detectado

El flujo manual ya empaqueta adjuntos como `.elpx`, pero el empaquetado actual es genérico y no resuelve de forma óptima los casos en los que todos los adjuntos son imágenes, audios o vídeos.

### Requisitos a evaluar mediante ADR

- RF-007: cuando todos los adjuntos manuales sean imágenes, evaluar si el `.elpx` generado debe mostrar una imagen única o una galería.
- RF-008: cuando todos los adjuntos manuales sean audios, evaluar si el `.elpx` generado debe mostrar un reproductor único o una colección reproducible.
- RF-009: cuando todos los adjuntos manuales sean vídeos, evaluar si el `.elpx` generado debe mostrar un reproductor único o una colección reproducible.
- RF-010: en casos mixtos o no clasificados, mantener un fallback genérico compatible con el pipeline actual.
- RF-011: preservar siempre la accesibilidad individual y reutilizable de cada `media_item` mediante URL directa.

### Estado de decisión

ADR-0020 queda aceptada el 2026-04-12. La implementación de RF-007 a RF-011 puede planificarse ya como feature derivada.

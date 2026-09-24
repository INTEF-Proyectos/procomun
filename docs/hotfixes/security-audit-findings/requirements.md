# Requisitos — Correcciones de auditoría de seguridad

## Contexto

La auditoría confirmó cinco fallos distintos de las cuentas de demostración, que quedan fuera de alcance por decisión del usuario al no formar parte del despliegue de producción.

## Requisitos

- Aplicar la política canónica de recursos también a la API con token.
- Impedir interacciones sociales sobre recursos no publicados.
- Limitar la lectura de `content.xml` antes de descomprimirlo por completo.
- Evitar que una misma fuente infle indefinidamente el contador de descargas.
- Aplicar en servidor una cuota acumulada de uploads por usuario.
- Mantener los contratos públicos actuales salvo respuestas de límite (`404` o `429`).

## Criterios transversales

Los controles deben ejecutarse en servidor, reutilizar código existente, conservar accesibilidad e interoperabilidad y dejar pruebas automatizadas reproducibles.


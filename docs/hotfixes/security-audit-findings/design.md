# Diseño — Correcciones de auditoría de seguridad

## Solución

1. Reutilizar `canManageResource` en todas las operaciones de publicación con token.
2. Resolver las operaciones sociales exclusivamente contra recursos publicados.
3. Leer los metadatos ELPX mediante la ruta limitada existente, antes de cualquier expansión sin límites.
4. Deduplicar o limitar eventos de descarga en el servidor.
5. Comprobar la cuota acumulada antes de aceptar una nueva sesión TUS.

No se añaden dependencias ni servicios. Los límites se apoyan en configuración y persistencia existentes.

## Análisis

El análisis se realizó con **Codex, modelo GPT-6**, usando la metodología del skill **`security-audit`**: revisión estática de entradas, límites de confianza y sinks, seguida de validación adversarial independiente de cada hallazgo.

## Riesgos

- Los límites en memoria no coordinan réplicas; se documentará cualquier techo deliberado.
- La deduplicación de descargas debe conservar métricas útiles sin identificar innecesariamente a visitantes.
- Los límites ELPX deben aceptar paquetes legítimos dentro de los topes ya definidos.


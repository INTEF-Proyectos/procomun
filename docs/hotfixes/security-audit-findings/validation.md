# Validación — Correcciones de auditoría de seguridad

## Criterios de aceptación

- Un curator no asignado recibe denegación al leer, modificar o borrar un recurso ajeno mediante token.
- Ratings, favoritos y reportes no aceptan recursos no publicados.
- Un `content.xml` que excede el límite se rechaza antes de cargarse completo en memoria.
- Repeticiones abusivas de descargas reciben límite o no incrementan la métrica.
- Un usuario que supera su cuota de uploads recibe `413` antes de crear otra sesión.

## Evidencia

- `bun test`: 1091 pruebas correctas, 0 fallos.
- `bun run check-types`: 0 errores.
- `bun run lint`: correcto, con avisos preexistentes fuera del cambio.
- `bun run check-tracking`: válido, sin claves duplicadas.
- `bun run design:lint`: contrato de diseño alineado.
- `bun audit`: 8 avisos transitivos preexistentes (2 altos y 6 moderados), fuera del alcance de este hotfix y pendientes de actualización separada.

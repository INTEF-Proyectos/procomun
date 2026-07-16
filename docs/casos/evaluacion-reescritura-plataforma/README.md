# Caso: evaluación de estrategia de modernización / reescritura de la plataforma

* Fecha: 2026-07-16
* Commit analizado: `eea2fe7d1e26d2c614bf245491956e805416e251` (`main`)
* Tipo de trabajo: **Caso** (análisis sin implementación) + **ADR propuesta**
* ADR resultante: [ADR-0029 — Estrategia de modernización y reescritura](../../negocio/decisiones/0029-estrategia-modernizacion-reescritura.md) (estado: Propuesto)

## Pregunta que responde este caso

¿Debe Procomún NG (a) mantenerse y refactorizarse, (b) reorganizarse como monolito modular, (c) sustituir tecnologías selectivamente, (d) reescribirse incrementalmente vía Strangler Fig, (e) reescribirse por completo de forma mecánica, o (f) reescribirse con rediseño simultáneo — o (g) no hay evidencia suficiente para cambiar nada estructural?

La decisión se basa en evidencia del repositorio, métricas reproducibles y fuentes externas fechadas. El entusiasmo tecnológico no cuenta como evidencia.

## Restricciones de partida (confirmadas por el encargo)

TypeScript strict, Bun, PostgreSQL en producción y PGlite en desarrollo se mantienen como decisiones estratégicas salvo impedimento crítico verificable. Los requisitos funcionales, editoriales, de interoperabilidad, accesibilidad, seguridad (ENS) y trazabilidad aceptados se preservan. No se introducen microservicios sin necesidad demostrable.

## Estructura del caso

| Documento | Contenido |
| --- | --- |
| [baseline.md](baseline.md) | Línea base medida y reproducible: comandos, tiempos, tamaños, errores, estado real de las puertas de calidad |
| [feature-inventory.md](feature-inventory.md) | Inventario funcional: implementado, testeado, documentado-sin-implementar, abandonado, comportamiento a preservar |
| [architecture-findings.md](architecture-findings.md) | Arqueología: evolución de ADRs, divergencias doc↔código, historia de migraciones ya ejecutadas, restricciones vigentes |
| [technology-assessment.md](technology-assessment.md) | Evaluación pieza a pieza: Hono, Drizzle, Better Auth, React Router+Vite, PGlite/PostgreSQL, Bun, dependencias |
| [alternatives.md](alternatives.md) | Las seis opciones (A–F) desarrolladas, con el mejor argumento a favor y en contra de la reescritura |
| [decision-matrix.md](decision-matrix.md) | Matriz ponderada con criterios definidos antes de puntuar, evidencia y confianza por celda |
| [pilot-plan.md](pilot-plan.md) | Piloto documental (no implementado) para validar la estrategia recomendada |
| [migration-and-rollback.md](migration-and-rollback.md) | Datos, migraciones, paridad PostgreSQL/PGlite, verificación y rollback |
| [validation.md](validation.md) | Qué se ejecutó, qué salió, y los gates verificables de la recomendación |
| [risks.md](risks.md) | Riesgos de cada opción, incluida la recomendada, sin minimizar |
| [implementation-agent-prompt.md](implementation-agent-prompt.md) | Prompt autónomo para la ejecución posterior de la estrategia recomendada (no ejecutar en esta fase) |

## Método

Trabajo distribuido en una organización multiagente con roles separados: coordinación, arqueología de arquitectura, inventario funcional, medición técnica, evaluación tecnológica, defensor de la reescritura, crítico de la reescritura, arquitectura incremental, datos y migraciones, seguridad/ENS/accesibilidad, QA y validación, costes y operación, y dos revisores adversariales independientes que revisaron los artefactos y el diff final (no las justificaciones internas de los redactores).

Fuentes externas consultadas el 2026-07-16 (detalle y citas en `alternatives.md` y en la ADR): el caso de la reescritura de Bun en Rust (bun.sh/blog/bun-in-rust, publicado 2026-07-08), Strangler Fig de Martin Fowler (2024-08-22), el patrón Strangler Fig del Azure Architecture Center (actualizado 2026-06) y «Things You Should Never Do, Part I» de Joel Spolsky (2000-04-06).

## Resultado

La recomendación exacta, su nivel de confianza, la matriz que la sustenta y las condiciones que podrían cambiarla están en la [ADR-0029](../../negocio/decisiones/0029-estrategia-modernizacion-reescritura.md). Este caso es exclusivamente documental: no se modificó código productivo, dependencias ni lockfiles.

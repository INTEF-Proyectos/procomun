# ADR-0021 Servicio canónico unificado para API y frontend

* Estado: Aceptado
* Fecha: 2026-04-12
* Agentes Implicados: [@.agents/skills/arquitectura-solucion, @.agents/skills/devops-sre, @.agents/skills/backend-api-servicios, @.agents/skills/documentacion-y-roadmap]

## Contexto y Problema

La implementación actual combina dos modos operativos distintos:

- en desarrollo local, `apps/api` y `apps/frontend` se ejecutan como dos procesos separados, con Vite haciendo proxy de `/api` hacia `localhost:3000`
- en Docker y despliegue integrado, el target `app` ya sirve la SPA compilada desde la propia API Hono mediante `SERVE_FRONTEND`

Esta dualidad genera ambigüedad sobre cuál es la arquitectura canónica del sistema. También hace fácil confundir una decisión de despliegue con una decisión de experiencia de desarrollo.

El problema a resolver no es solo técnico, sino de claridad arquitectónica: hay que fijar qué modo es el oficial para despliegue, qué modo es el recomendado para desarrollo diario y qué complejidad no compensa introducir todavía.

## Opciones Consideradas

* **A) Unificar completamente en un único proceso también en desarrollo**: integrar Vite en modo middleware dentro de Hono y eliminar la separación actual entre `dev:api` y `dev:frontend`.
* **B) Mantener un servicio canónico unificado para despliegue y Docker, conservando desarrollo local dual con Vite**: formalizar el target `app` como modo canónico de ejecución integrada y mantener el flujo actual de desarrollo por ergonomía.
* **C) Separar completamente frontend y API en todos los entornos**: convertir la separación en norma también para producción, manteniendo servidor estático o reverse proxy separado.

## Decisión

Se elige la **opción B**.

La arquitectura canónica de despliegue de Procomún será un **servicio integrado** en el que la API Hono sirve también el frontend compilado. Ese modo ya existe en el target `app` del `Dockerfile` y es el que usa `docker-compose.yml`.

Para el **desarrollo local de producto** se mantiene, por ahora, el modelo dual actual:

- `apps/api` en Bun/Hono
- `apps/frontend` en Vite con HMR y proxy hacia la API

La razón principal es pragmática:

1. La unificación ya está resuelta en despliegue y Docker, que es donde la simplicidad operacional aporta más valor.
2. El modo dual actual ofrece mejor ergonomía de desarrollo frontend gracias a Vite y su HMR nativo.
3. Integrar Vite middleware dentro de Hono aumentaría complejidad de arranque, acoplamiento y superficie de mantenimiento sin resolver hoy un problema crítico del producto.
4. Mantener separación completa también en producción iría contra la implementación existente y añadiría complejidad operativa sin necesidad actual.

Por tanto, la decisión formal es:

- **despliegue canónico**: un único servicio/proceso integrado
- **desarrollo local canónico**: dos procesos coordinados (`bun run dev`, `make up`)
- **revisión futura**: solo se reconsiderará Vite middleware mode si la fricción del modo dual supera el coste de mantenimiento adicional

## Consecuencias

### Positivas
* Se elimina la ambigüedad arquitectónica: el despliegue oficial ya no compite con otros modos alternativos.
* Se mantiene la mejor experiencia de desarrollo frontend disponible hoy en el repo.
* Docker Compose, variables de entorno y topología de puertos quedan alineados con la implementación real.
* La API sigue siendo el punto único de entrada en despliegues integrados.
* Se evita introducir prematuramente una integración más compleja de Vite dentro de Hono.

### Negativas / Riesgos
* Sigue existiendo una diferencia entre el modo de desarrollo local y el modo de despliegue.
* La documentación debe explicar con precisión ambos modos para evitar confusión.
* Si en el futuro se quisiera un único proceso también en desarrollo, habrá que abordar una integración explícita con Vite middleware.
* El target `frontend` basado en nginx puede quedar como artefacto histórico mientras no se retire o se documente como no canónico.

## Notas de Implementación

- `docker-compose.yml` y el target `app` del `Dockerfile` se consideran la referencia operativa para despliegue integrado.
- `apps/api/src/app/frontend.ts` se mantiene como mecanismo oficial para servir el frontend compilado desde la API.
- `apps/frontend/vite.config.ts` sigue siendo la configuración recomendada para desarrollo local, incluyendo el proxy de `/api` y el soporte del dashboard `/dev/`.
- No se implementa en esta ADR la integración de `vite.createServer()` como middleware de Hono.
- Si se decide abordar esa integración en el futuro, deberá abrirse una nueva issue de implementación o una ADR complementaria que evalúe coste, impacto en DX y estrategia de pruebas.

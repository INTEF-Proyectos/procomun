# ADR-0023 Evaluación de migración de Vite a Bun como bundler del frontend

* Estado: Rechazado
* Fecha: 2026-05-26
* Agentes Implicados: [@.agents/skills/evaluacion-tecnologica, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/direccion-de-plataforma]

## Contexto y Problema

Tras la migración de Astro a React Router + Vite SPA (ADR-0018), el frontend usa Vite 8 (con Rolldown) como bundler y dev server. Dado que el proyecto ya usa Bun como runtime en todo el stack (ADR-0001), se evalúa si reemplazar Vite por `bun build` simplificaría la cadena de herramientas sin degradar la experiencia de desarrollo.

La motivación principal es la coherencia de tooling: usar un único runtime/bundler (Bun) para todo el proyecto, eliminando Vite como dependencia adicional.

## Investigación Realizada (mayo 2026)

### Estado actual del bundler de Bun

| Capacidad | Bun bundler (mayo 2026) | Vite 8 + Rolldown |
|-----------|------------------------|-------------------|
| Velocidad de build | ~2-7s (proyectos grandes) | ~2.9-8.7s (proyectos grandes) |
| Sistema de plugins | API propia, limitada | API Rollup completa (800+ plugins) |
| Compatibilidad plugins Vite/Rollup | No directa (requiere Unplugin o port) | Nativa |
| React Fast Refresh | No soportado (solo HMR a nivel módulo) | Sí, completo |
| Dev server proxy | No built-in (requiere código custom) | `server.proxy` declarativo |
| HMR con preservación de estado | Parcial (pierde estado de componentes) | Completo |
| Soporte Paraglide i18n | No existe plugin nativo | Plugin oficial funcional |

### Bloqueos técnicos identificados

#### 1. Paraglide i18n sin plugin para Bun bundler

El sistema de internacionalización usa `paraglideVitePlugin` de `@inlang/paraglide-js` con configuración de URL patterns para 5 locales (es, en, ca, gl, eu). Este plugin intercepta el proceso de build de Vite para generar código de traducción.

**Actualización mayo 2026:** Paraglide ofrece ahora un modo CLI standalone (`paraglide generate`) que permite pre-generar código fuera de Vite. Sin embargo, la integración es manual: requiere un paso previo al build, no tiene hot-reload de traducciones en desarrollo, y la configuración de URL patterns debe replicarse manualmente fuera del plugin. La experiencia de desarrollo se degrada significativamente respecto al plugin de Vite que regenera automáticamente en cada cambio.

#### 2. React Fast Refresh no disponible en Bun

`@vitejs/plugin-react` proporciona React Fast Refresh: actualización de componentes React preservando el estado local (hooks, formularios, etc.). Bun ofrece HMR a nivel de módulo (`import.meta.hot`) pero **no implementa React Fast Refresh** — cada cambio recarga el módulo completo, perdiendo todo el estado de componentes.

En un frontend con 67+ islands React, formularios complejos y estados de UI ricos, perder Fast Refresh degradaría sustancialmente la productividad del desarrollo.

#### 3. Proxy de dev server requiere código custom

Vite ofrece `server.proxy` declarativo (4 líneas de config). Bun no tiene equivalente built-in — requiere escribir un servidor proxy custom con `Bun.serve()`, lo que añade complejidad y código a mantener.

#### 4. Ventaja de velocidad de build eliminada por Vite 8 + Rolldown

Vite 8 migró internamente a Rolldown (bundler Rust), cerrando la brecha de rendimiento con Bun. Ambos están ahora en la misma clase de velocidad nativa (~2-8s para proyectos grandes). El build actual del frontend es **~1.3-1.4s**, un tiempo que no justifica ninguna migración por rendimiento.

## Opciones Consideradas

* **A) Migrar a Bun bundler ahora**: Reemplazar Vite por `bun build` + scripts custom para i18n y proxy.
* **B) Mantener Vite 8 con Rolldown (status quo)**: Conservar la configuración actual que funciona correctamente.
* **C) Migración parcial**: Usar `bun build` para producción pero mantener Vite dev server para desarrollo.
* **D) Reevaluar en el futuro**: Mantener Vite y monitorizar el ecosistema Bun para una migración cuando los bloqueos se resuelvan.

## Decisión

Se elige la **opción B (status quo)** combinada con **opción D (reevaluación futura)**: mantener Vite 8 + Rolldown como bundler del frontend.

**Justificación principal:**

1. **No hay ganancia de rendimiento**: Vite 8 con Rolldown iguala la velocidad de Bun bundler. El build actual (1.4s) es excelente.
2. **Degradación de DX inaceptable**: Perder React Fast Refresh en 67+ componentes React impacta directamente la productividad diaria del equipo.
3. **Coste de migración alto, beneficio marginal**: Reemplazar un plugin declarativo de i18n por scripts manuales y un proxy custom añade complejidad sin ganar funcionalidad.
4. **Riesgo de regresión**: La integración Paraglide + URL patterns es crítica para i18n y está probada con el plugin de Vite.
5. **Vite es ligero**: La configuración actual son 68 líneas, build en 1.4s, y zero-config para el equipo. No es un cuello de botella.

La coherencia de usar "solo Bun" no justifica degradar la experiencia de desarrollo ni asumir deuda técnica en i18n y proxy.

## Consecuencias

### Positivas
* Se mantiene React Fast Refresh completo para desarrollo productivo
* Se conserva la integración Paraglide probada y declarativa
* Se evita escribir y mantener código custom para proxy y i18n
* Se aprovechan las mejoras de rendimiento de Rolldown (10-30x más rápido que Rollup anterior)
* Zero riesgo de regresión: no se toca nada que funciona

### Negativas / Riesgos
* Vite permanece como dependencia adicional al stack Bun (coste mínimo: ~30MB, bien mantenido)
* Dos herramientas de bundling en el proyecto (Bun para runtime/test, Vite para frontend build)
* Si Bun madura significativamente, habrá que hacer esta migración más adelante igualmente

## Condiciones de Reevaluación

Esta decisión debe revisarse cuando se cumpla **al menos una** de estas condiciones:

- [ ] Bun implementa React Fast Refresh nativo en su dev server
- [ ] Bun añade un sistema de plugins compatible con Rollup/Vite (o Unplugin soporte completo)
- [ ] Paraglide publica un plugin nativo para Bun bundler con hot-reload
- [ ] El proyecto decide migrar a otra solución de i18n que no dependa de plugins de build
- [ ] Bun añade proxy de dev server integrado declarativo
- [ ] Vite deja de mantenerse o introduce problemas significativos

## Notas de Implementación

No se requiere ningún cambio en el código. La configuración actual se mantiene:

- **Bundler**: Vite 8 + Rolldown (`vite.config.ts`, 68 líneas)
- **Dev server**: `vite` con proxy a localhost:3000
- **i18n**: `paraglideVitePlugin` con URL patterns para 5 locales
- **React HMR**: `@vitejs/plugin-react` con Fast Refresh
- **Runtime/Test**: Bun (sin cambios)

### Referencias

- ADR-0001: TypeScript + Bun como stack base
- ADR-0018: Migración de Astro a React Router + Vite
- Issue #114: Evaluar migración de Vite a Bun como bundler
- [Bun Bundler docs](https://bun.sh/docs/bundler)
- [Vite 8 + Rolldown announcement](https://vite.dev/blog/announcing-vite8-beta)
- [Unplugin cross-bundler plugins](https://unplugin.unjs.io/guide/)
- [Paraglide JS docs](https://inlang.com/documentation/paraglide-js)

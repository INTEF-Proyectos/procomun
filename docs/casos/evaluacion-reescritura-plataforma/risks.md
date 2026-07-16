# Riesgos por opción — sin minimizar los de la recomendada

* Fecha: 2026-07-16 · Commit: `eea2fe7d`
* Escalas cualitativas (Prob./Impacto: Baja-Media-Alta). No hay base para probabilidades numéricas.

## 1. Riesgos de la opción recomendada (simplificación incremental, A→B con C selectiva)

Estos son los riesgos de lo que la ADR-0029 recomienda; se listan primero y sin atenuar:

| # | Riesgo | Prob. | Impacto | Señal temprana | Mitigación |
| --- | --- | --- | --- | --- | --- |
| R1 | **El lint real y el typecheck destapan más trabajo del previsto** (4 meses de diagnósticos acumulados; los 635 errores pueden esconder bugs reales, no solo ruido de tipos). *Actualización 2026-07-16: la mitad de lint se materializó y resolvió en la PR #272 (111 errores arreglados de verdad en ~1 día, sin rebajas ni supresiones); el riesgo sigue vivo para el typecheck (Lote 1)* | Media | Medio | El burndown del ratchet se estanca; aparecen errores que exigen rediseño de tipos en `repository/` | Es trabajo deseable (los bugs enmascarados son el motivo de `strict`); tratarlo por lotes con presupuesto propio; si un lote excede 2× su estimación, reportar y repriorizar |
| R2 | **La simplificación se queda a medias** (se arregla lo barato — biome, deps — y se abandona lo estructural — esquema único, caracterización) dejando la deuda de fondo intacta con apariencia de resuelta | Media | Alto | Lotes 0–1 cerrados y lote 2–3 sin arrancar en el plazo | Gates por lote en CI con métricas objetivo escritas (tsc=0, fuente única, 17 fixme→0); revisión humana al cierre de cada lote |
| R3 | **Convertir tests de auth simulada a login real destapa defectos de composición de gates** (precedente: IDOR #221) que obligan a correcciones de producto no planificadas | Media | Medio | Fase 0 del piloto encuentra >3 defectos de gates | Contabilizarlos como hallazgos (valor, no desviación); presupuesto de corrección aparte |
| R4 | **El coste de oportunidad no es cero**: 2–10 semanas de saneamiento compiten con Fase 2 con el mismo equipo de 2 personas | Alta | Medio | Fase 2 no arranca tras el lote 2 | Los lotes son interrumpibles por diseño; el orden pone primero lo que acelera Fase 2 (gates, caracterización) |
| R5 | **La regla de paridad archivo-test y el umbral de cobertura crean tests de relleno** que inflan la señal de calidad sin capturar comportamiento (ya hay señales: tests de shell estático en frontend) | Media | Medio | Cobertura estable pero DEF de QA manual no bajan | Medir también DEF por ronda de QA manual; privilegiar contract tests y E2E sobre unit de relleno |
| R6 | **El workaround del exit-code 99/100 del runner enmascara un fallo real** algún día (cierres sucios, corrupción de PGlite) | Baja | Alto | Flakiness creciente en CI | Deuda vigilada documentada; re-evaluar con cada upgrade de Bun/PGlite |
| R7 | **Deriva de esquema adicional antes de consolidar la fuente única** (alguien añade una migración muerta más o un ALTER solo en setup.ts) | Media | Alto | Nuevo archivo en `migrations/` sin journal | Priorizar el lote 3 (esquema) inmediatamente tras la caracterización mínima; test de paridad `pg_dump` como gate permanente |
| R8 | **ENS queda otra vez pospuesta** (la épica ens sigue con 0/12 tareas y fuera de status.yaml) | Media | Alto (legal) | La épica sigue sin entrada en status.yaml al cierre del lote 2 | La ADR-0029 la lista como pregunta pendiente que requiere decisión humana explícita |

## 2. Riesgos comunes a cualquier estrategia

* **Sin producción real**: no hay usuarios, tráfico ni SLO; toda afirmación de rendimiento u operación es extrapolación. La ventana «barata» actual caduca en cuanto NG entre en producción con datos reales.
* **Observabilidad ~cero** (sin métricas/tracing/error-tracking): cualquier estrategia que llegue a producción sin resolverla operará a ciegas. Tarea aparte en todas las opciones.
* **Los defectos de QA manual siguen llegando** (13 registros nuevos el 2026-07-02): el flujo editorial de escritura carece de E2E activo, así que la detección seguirá siendo manual hasta des-fixmear esos tests.
* **CodeQL/Secret Scanning no verificables desde el repo** (dependen de la UI de GitHub): hueco de evidencia ENS.

## 3. Riesgos específicos de las opciones NO recomendadas (para trazabilidad)

**D — Strangler Fig interno:** coste fijo de fachada/coexistencia desproporcionado para ~30k LOC; la fachada puede romper CSP/cookies/XFF (auditoría ENS); carga cognitiva máxima para 2 devs; contraindicado por la propia fuente del patrón para sistemas pequeños.

**E — Reescritura mecánica:** (1) el oráculo hay que construirlo primero (3–8 semanas) y sin él la operación es un salto de fe; (2) todo lo implícito no cubierto por tests black-box se pierde — matices RBAC, workarounds de plataforma que el mismo stack volverá a necesitar, compatibilidades prometidas; (3) doble mantenimiento durante la ventana con QA activa; (4) Fase 2 congelada 2–5 meses; (5) re-validación ENS/RGPD/a11y sin criterios de aceptación escritos aún; (6) el precedente de 47 DEF en 3 rondas indica cuánto comportamiento fino habría que re-descubrir; (7) riesgo de deriva a F («ya que estamos, mejoremos esto») — el caso Bun lo prohibía explícitamente y es la degeneración más común.

**F — Reescritura con rediseño:** todos los de E más: invalida el único oráculo disponible (el comportamiento objetivo cambia), exige re-especificar el producto, duración sin base de estimación, y máximo coste de oportunidad. Ninguno de los 14 gates del encargo se cumple hoy para F.

## 4. Riesgos de segunda orden de esta propia evaluación

* Las cifras de esfuerzo (2–6, 4–10 semanas…) son juicio calibrado sobre unidades contadas, no datos históricos de velocidad: pueden desviarse; por eso cada lote lleva gate de re-planificación al exceder 2× su rango.
* La clasificación de los 47 DEF (cuántos siguen abiertos) es ruidosa: los documentos de QA no marcan correcciones y los IDs se reinician por ronda; el cruce fino con issues de GitHub no se hizo (se declara como pregunta pendiente).
* El análisis se hizo sin acceso a decisiones de INTEF sobre Fase 2 (comunidades, artículos, app móvil «a validar»): si INTEF exigiera replicar el legacy completo, el inventario de capacidades objetivo cambiaría y la matriz debería revisarse (no necesariamente hacia una reescritura).

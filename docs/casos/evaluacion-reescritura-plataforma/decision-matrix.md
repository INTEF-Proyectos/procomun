# Matriz de decisión ponderada

* Fecha: 2026-07-16 · Commit: `eea2fe7d`
* **Los criterios y pesos se definieron antes de puntuar las opciones** (esta sección precede a la puntuación y no se alteró después).
* Escala de puntuación: ordinal 1–5 (5 = mejor para el proyecto). Las puntuaciones son juicios anclados en la evidencia citada, no mediciones; los totales sirven para ordenar opciones, no como medida cardinal. Se declara la confianza por criterio (Alta/Media/Baja).

## 1. Opciones

* **A** — Mantener y refactorizar · **B** — Monolito modular evolutivo · **C** — Sustitución tecnológica selectiva · **D** — Strangler Fig interno · **E** — Reescritura completa mecánica (paridad primero) · **F** — Reescritura completa con rediseño.

## 2. Criterios, pesos y justificación del peso

| # | Criterio | Peso | Por qué este peso |
| --- | --- | ---: | --- |
| 1 | Reducción demostrable de complejidad | 2 | Objetivo del encargo, pero subordinado a entregar valor |
| 2 | Mantenibilidad | 3 | Plataforma pública de larga vida |
| 3 | Tiempo hasta obtener valor | 3 | Fase 2 (P0) está pendiente; expediente con plazos |
| 4 | Riesgo de regresión | 3 | 47 DEF demuestran comportamiento fino difícil de re-descubrir |
| 5 | Capacidad para seguir entregando | 3 | Equipo pequeño verificado (2 devs + agentes) |
| 6 | Coste inicial | 2 | Relevante pero recuperable |
| 7 | Coste total de propiedad | 2 | Horizonte plurianual |
| 8 | Coste de coexistencia | 2 | Toda ventana dual se paga con equipo pequeño |
| 9 | Reversibilidad | 2 | Criterio transversal del proyecto |
| 10 | Facilidad de rollback | 2 | Ídem |
| 11 | Preservación de datos | 2 | Hoy solo hay seed (riesgo bajo), pero es mandato |
| 12 | Rendimiento | 1 | Sin problema medido (arranque 0,6 s; bundle 92,5 kB gzip); nada que arreglar |
| 13 | Seguridad | 3 | Código endurecido (.elpx, RBAC) es lo más caro de re-ganar |
| 14 | Privacidad y ENS | 3 | Obligación legal (RD 311/2022, Categoría MEDIA) |
| 15 | Accesibilidad | 2 | Gate axe existente; obligación RD 1112/2018 |
| 16 | Interoperabilidad | 2 | SCORM/IMS/EPUB, LOM-ES, OAI-PMH futuro |
| 17 | Experiencia editorial | 2 | Usuario principal interno |
| 18 | Experiencia de búsqueda | 2 | Depende de liberar capacidad para Fase 2 |
| 19 | Capacidad de pruebas | 3 | El hueco de caracterización es el hallazgo central |
| 20 | Disponibilidad de conocimiento | 2 | Conocimiento codificado en fixes y tests |
| 21 | Madurez del ecosistema | 1 | Igual para todas (mismo stack por restricción) |
| 22 | Lock-in | 1 | Ya evaluado y asumido en ADR-0001/0023 |
| 23 | Carga cognitiva | 2 | Equipo pequeño; agentes IA necesitan repos legibles |
| 24 | Disponibilidad de personal con experiencia | 1 | Stack común (TS/React/PG) en todas las opciones |
| 25 | Observabilidad | 1 | Hoy es ~cero en todas; añadirla es tarea aparte |
| 26 | Facilidad operativa | 2 | Servicio único canónico (ADR-0021) |

Suma de pesos: 54. Máximo posible: 270.

## 3. Puntuaciones

| # | Criterio (peso) | A | B | C | D | E | F | Evidencia y confianza |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| 1 | Reducción complejidad (2) | 3 | 5 | 4 | 2 | 4 | 3 | B elimina dualidades (esquema, drivers, puertos) con verificación por paso; D añade fachada; E la elimina de una pasada pero re-crea incógnitas. Confianza Media |
| 2 | Mantenibilidad (3) | 3 | 5 | 4 | 2 | 4 | 3 | B instala gates de arquitectura (greps CI) y fuente única de esquema; evidencia: seams ya existentes (`crud-builder`, `repository/`). Media |
| 3 | Tiempo hasta valor (3) | 5 | 4 | 4 | 2 | 1 | 1 | Rangos del informe de costes: A 2–6 sem; B 4–10 sem incrementales; E 3–8 sem de oráculo + 2–5 meses. Alta para el orden, Baja para los absolutos |
| 4 | Riesgo de regresión (3) | 5 | 4 | 4 | 3 | 2 | 1 | Suite actual válida sin traducción en A/B/C; en E/F los tests unitarios acoplados no sobreviven (informe QA §2). Alta |
| 5 | Seguir entregando (3) | 5 | 4 | 4 | 2 | 1 | 1 | E/F congelan Fase 2 toda la ventana; D la ralentiza; A/B son interrumpibles. Alta |
| 6 | Coste inicial (2) | 5 | 4 | 4 | 2 | 1 | 1 | Ver rangos §3 de costes. Media |
| 7 | Coste total de propiedad (2) | 4 | 5 | 4 | 2 | 3 | 2 | B paga una vez los límites que abaratan todo cambio futuro (lección Astro→React). Media |
| 8 | Coste de coexistencia (2) | 5 | 5 | 5 | 2 | 2 | 1 | A/B/C: cero (no hay segundo sistema). Alta |
| 9 | Reversibilidad (2) | 5 | 5 | 4 | 3 | 2 | 1 | A/B por lotes con revert; E/F concentran el riesgo en el corte. Alta |
| 10 | Rollback (2) | 5 | 5 | 4 | 3 | 2 | 1 | Ídem; además no existe tooling de backup/restore hoy (informe datos §2). Alta |
| 11 | Preservación de datos (2) | 5 | 5 | 5 | 4 | 4 | 2 | Solo hay seed; aún así F re-modela y multiplica verificación. Alta |
| 12 | Rendimiento (1) | 3 | 3 | 3 | 3 | 3 | 3 | Sin evidencia diferencial en ninguna dirección; no hay benchmark de carga propio. Baja |
| 13 | Seguridad (3) | 4 | 5 | 4 | 3 | 2 | 1 | E/F re-arriesgan el código endurecido (elpx, IDOR, matices RBAC); B añade puerto auth y matriz de permisos como contrato (informe seguridad §3/§6). Alta |
| 14 | Privacidad y ENS (3) | 4 | 5 | 4 | 3 | 2 | 1 | Coexistencia dual duplica superficies con datos personales; RGPD actual no la contempla (informe seguridad §4). Alta |
| 15 | Accesibilidad (2) | 4 | 4 | 4 | 3 | 3 | 2 | El gate axe (10 tests wcag2a/aa) sobrevive a todas; el riesgo de F es re-introducir defectos en UI reconstruida. Media |
| 16 | Interoperabilidad (2) | 4 | 4 | 4 | 3 | 3 | 2 | Exportaciones SCORM/IMS/EPUB implementadas y testeadas hoy; re-verificación costosa en E/F. Media |
| 17 | Experiencia editorial (2) | 3 | 4 | 3 | 3 | 3 | 3 | Mayormente igual; B mejora indirecto (menos DEF por gates y matriz RBAC); mejoras de F son hipotéticas sin spec. Baja |
| 18 | Experiencia de búsqueda (2) | 4 | 4 | 4 | 2 | 1 | 1 | La mejora real de búsqueda es Fase 2 (F2-02/03/04); puntúa la capacidad de liberarla pronto. Media |
| 19 | Capacidad de pruebas (3) | 3 | 5 | 4 | 4 | 4 | 1 | B incluye deliberadamente la suite de caracterización (contract tests, des-fixmear E2E); D/E la fuerzan como precondición; F invalida el oráculo. Alta |
| 20 | Conocimiento disponible (2) | 5 | 5 | 4 | 3 | 2 | 1 | Conocimiento en fixes/tests se conserva in situ; E/F lo re-descubren (47 DEF como precedente). Alta |
| 21 | Madurez del ecosistema (1) | 4 | 4 | 4 | 4 | 4 | 3 | Mismo stack por restricción; F podría introducir piezas nuevas sin madurar. Media |
| 22 | Lock-in (1) | 3 | 4 | 4 | 3 | 3 | 3 | Los puertos de B reducen lock-in efectivo (sustituciones futuras más baratas). Media |
| 23 | Carga cognitiva (2) | 4 | 4 | 4 | 1 | 2 | 1 | Fachada + dos implementaciones (D) o dos sistemas (E/F) es lo más caro cognitivamente para 2 devs. Alta |
| 24 | Personal con experiencia (1) | 4 | 4 | 4 | 3 | 3 | 2 | TS/React/PG estándar en todas. Baja |
| 25 | Observabilidad (1) | 3 | 3 | 3 | 2 | 3 | 3 | Hoy ~cero (sin métricas/tracing/error-tracking, verificado); todas necesitan la misma tarea aparte; D añade la fachada a operar. Alta sobre el estado, Baja sobre la diferencia |
| 26 | Facilidad operativa (2) | 5 | 5 | 4 | 2 | 2 | 1 | A/B/C conservan el servicio único (ADR-0021); D/E/F añaden piezas o duplican stacks temporalmente. Alta |

## 4. Totales

| | A | B | C | D | E | F |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Total ponderado** (máx. 270) | 226 | **242** | 216 | 152 | 132 | 85 |
| % del máximo | 84 % | **90 %** | 80 % | 56 % | 49 % | 31 % |
| Total sin ponderar (máx. 130) | 107 | **114** | 103 | 69 | 66 | 45 |

## 5. Sensibilidad y lectura

* **El orden B > A > C ≫ D > E ≫ F es robusto**: se mantiene con todos los pesos a 1 (fila «sin ponderar») y ante perturbaciones razonables de pesos individuales (±1 en cualquier criterio no altera el podio; la brecha A/B/C frente a D/E/F es de 64+ puntos ponderados).
* A y B están cerca por diseño: B **contiene** a A y añade límites/caracterización; la elección práctica no es «A o B» sino hasta dónde llegar en el mismo camino. C se solapa con ambas (sus dos únicas sustituciones justificadas — biome real y driver único — están incluidas en los lotes de A/B).
* E puntúa por encima de D en reducción de complejidad pero muy por debajo en valor/riesgo/entrega; su mejor variante exige exactamente la inversión (oráculo) que hace innecesaria la propia reescritura.
* Limitación declarada: los criterios 12, 17, 24 y 25 discriminan poco (sin datos diferenciales); retirarlos no cambia el orden. No se usó precisión decimal porque los datos no la soportan.

## 6. Correspondencia con la recomendación

La matriz ordena: **B (monolito modular evolutivo) primero, con A como su primer tramo y las dos sustituciones justificadas de C incorporadas**. Esto se traduce en la recomendación de la ADR-0029: «Rechazar la reescritura completa y ejecutar simplificación incremental», materializada como el programa por lotes 0–5 descrito en `alternatives.md` y en el plan piloto.

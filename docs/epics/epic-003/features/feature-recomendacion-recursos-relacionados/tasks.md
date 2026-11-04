# Tasks — Recursos relacionados

* Issue: #72
* Fecha: 2026-08-06

## 2026-08-06 — Implementación inicial

- [x] ADR-0036
- [x] requirements.md + design.md
- [x] Módulo de score puro + tests unitarios
- [x] Servicio SQL multi-señal + tests
- [x] Endpoint `GET /api/v1/resources/:slug/related`
- [x] Cliente API + UI en ficha + i18n
- [x] status.yaml + PR que cierra #72

## 2026-11-03 — Solo colecciones publicadas (#485)

- [x] La co-ocurrencia en colecciones (señal y filtro de candidatos) solo cuenta colecciones publicadas.
- [x] Regresión rojo → verde en `apps/api/src/recommendations/service.unit.test.ts`.
- [x] Adenda fechada en ADR-0036 y entrada en `status.yaml`.

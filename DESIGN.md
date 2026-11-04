---
version: alpha
name: Procomun
description: Sistema de diseno para una plataforma publica de recursos educativos abiertos, con foco editorial, busqueda, reutilizacion y gestion interna.
colors:
  primary: "#003fb1"
  primary-container: "#1a56db"
  on-primary: "#ffffff"
  secondary: "#006a61"
  secondary-container: "#86f2e4"
  tertiary: "#7c3400"
  tertiary-container: "#a24500"
  error: "#ba1a1a"
  background: "#f8f9ff"
  surface: "#f8f9ff"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#eef4ff"
  surface-container: "#e5eeff"
  surface-container-high: "#dfe9fa"
  surface-container-highest: "#d9e3f4"
  on-surface: "#121c28"
  on-surface-variant: "#434654"
  outline: "#6c6f7f"
  outline-variant: "#c3c5d7"
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 3.5rem
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: 0
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: 0
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label-lg:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0
rounded:
  xs: 0.125rem
  sm: 0.25rem
  md: 0.5rem
  lg: 0.75rem
  xl: 1rem
  2xl: 1.5rem
  full: 9999px
spacing:
  0: 0
  1: 0.25rem
  2: 0.5rem
  3: 0.75rem
  4: 1rem
  5: 1.25rem
  6: 1.5rem
  8: 2rem
  10: 2.5rem
  12: 3rem
  16: 4rem
  20: 5rem
  24: 6rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    padding: "{spacing.2} {spacing.5}"
    minHeight: 2.5rem
  button-secondary:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    borderColor: "{colors.primary}"
    rounded: "{rounded.full}"
    padding: "{spacing.2} {spacing.5}"
  input:
    backgroundColor: "{colors.surface-container-highest}"
    textColor: "{colors.on-surface}"
    borderColor: transparent
    rounded: "{rounded.md}"
    padding: "{spacing.2} {spacing.3}"
  chip:
    backgroundColor: "{colors.surface-container-highest}"
    textColor: "{colors.on-surface-variant}"
    rounded: "{rounded.full}"
    padding: "{spacing.1} {spacing.3}"
  card:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.on-surface}"
    borderColor: "{colors.outline-variant}"
    rounded: "{rounded.lg}"
    padding: "{spacing.4}"
  navigation:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.on-surface}"
    activeColor: "{colors.primary}"
    rounded: "{rounded.full}"
---

# Procomun Design Contract

## Overview

Procomun es una plataforma publica de recursos educativos abiertos. La interfaz debe sentirse editorial, clara y operativa: ayuda al profesorado a encontrar, evaluar, reutilizar y publicar recursos sin convertir el catalogo en una experiencia decorativa o comercial.

Este contrato documenta la direccion visual que ya existe en `apps/frontend/src/styles/design-tokens.css` y en los componentes React de `apps/frontend/src/ui/`. Mientras la especificacion `DESIGN.md` siga en estado `alpha`, este fichero funciona como artefacto derivado y validado, no como sustituto automatico de los tokens CSS.

## Colors

La paleta combina azul institucional, verde/teal para acciones de apoyo y un naranja calido para avisos editoriales. Las superficies usan azules muy claros para mantener jerarquia sin depender de bordes pesados.

- **Primary (`#003fb1`)**: acciones principales, foco visible, enlaces y estados activos.
- **Secondary (`#006a61`)**: senales positivas, confirmaciones y acciones secundarias de valor.
- **Tertiary (`#7c3400`)**: avisos, estados pendientes y llamadas editoriales que no son error.
- **Surface containers**: fondos de paneles, tablas, filtros, fichas y zonas de metadatos.
- **Error (`#ba1a1a`)**: errores de validacion, acciones destructivas y estados bloqueantes.

No se deben introducir colores ad hoc en nuevas pantallas. Si falta un color semantico, se actualiza primero `design-tokens.css` y despues este contrato.

## Typography

La jerarquia usa `Plus Jakarta Sans` para titulos y componentes con peso editorial, e `Inter` para lectura continua, formularios, tablas y metadatos. El texto no debe escalar con el ancho de viewport; se usan tamanos discretos y contenedores responsivos.

- Titulos de pagina: `headline-md` o `display-lg` solo en heroes reales.
- Titulos de panel, ficha o dialogo: `title-md` o `headline-md`.
- Texto funcional: `body-md`.
- Etiquetas, badges y controles compactos: `label-lg`.

El espaciado entre letras debe permanecer en `0` salvo etiquetas muy cortas ya existentes que lo justifiquen.

## Layout

Las pantallas publicas priorizan descubrimiento y lectura: buscador visible, facetas claras, tarjetas escaneables y fichas de recurso con metadatos ordenados. El backoffice debe ser mas denso, con tablas, filtros y acciones predecibles.

- Anchura maxima de contenido publico: `--max-width`.
- Formularios y lectura larga: `--max-width-narrow`.
- Vistas de administracion y comparacion: layouts de ancho completo con contenedor interno.
- No se deben anidar tarjetas dentro de tarjetas.
- Las secciones de pagina son bandas o layouts sin marco; las tarjetas se reservan para elementos repetidos, dialogos y herramientas enmarcadas.

## Depth & Elevation

La profundidad se expresa con capas tonales y sombras suaves, no con bordes duros en todas las superficies. Las tarjetas de recurso, paneles de filtros y dialogos usan superficies claras con sombra controlada para diferenciar contenido interactivo de secciones de pagina.

- `--shadow-sm`: separacion sutil en chips, metadatos y pequenos contenedores.
- `--shadow-md`: hover, focus contextual y cards interactivas.
- `--shadow-xl`: elementos destacados como recursos recomendados o paneles de alto valor.
- `--shadow-ambient`: bloques editoriales amplios sin apariencia de modal.

No se debe usar elevacion para compensar una jerarquia de informacion poco clara. Si todo parece una tarjeta, la pantalla pierde escaneabilidad.

## Components

Los componentes de referencia viven en `apps/frontend/src/ui/`. Cualquier pantalla nueva debe reutilizarlos antes de crear variantes.

- **Button**: acciones primarias, secundarias, fantasma y destructivas. Mantener foco visible y altura minima tactil.
- **Input, Select, Checkbox, SearchBar**: controles con estado de error, ayuda asociada y `aria-*` cuando proceda.
- **Chip y Badge**: taxonomias, estados editoriales, idiomas, licencias y filtros activos.
- **ResourceCard y ResourceGrid**: listados publicos de recursos.
- **FilterPanel**: facetas y filtros del catalogo.
- **Dialog y Drawer**: modales y paneles con gestion de foco.
- **Tabs, Breadcrumb y Pagination**: navegacion local sin romper historial ni accesibilidad.

## Accessibility

El minimo es WCAG 2.2 AA. Los agentes y personas que modifiquen UI deben comprobar:

- Contraste suficiente en texto, controles y estados.
- Foco visible con `--color-primary`.
- Estados de error que no dependan solo del color.
- Etiquetas asociadas a controles.
- `aria-live`, `role="alert"` o `role="status"` para feedback dinamico cuando aplique.
- Objetivos tactiles de al menos 44px en acciones principales.
- Responsive movil, tablet y escritorio sin solapamiento de texto.

## Responsive Behavior

La navegacion, las facetas y las tablas deben colapsar de forma funcional, no solo visual.

- Movil: buscador prioritario, filtros como panel/drawer, tarjetas en una columna y acciones principales visibles.
- Tablet: grid de recursos flexible, filtros laterales si hay ancho suficiente y metadatos en bloques legibles.
- Escritorio: layouts de dos columnas para fichas, sidebar de facetas persistente y backoffice con tablas densas.
- Los textos largos deben envolver; no se permite que botones, badges o celdas rompan el contenedor.
- Las zonas tactiles mantienen al menos 44px aunque el contenido visual sea compacto.

## Agent Prompt Guide

Cuando un agente trabaje en UI de Procomun, debe seguir este prompt operativo:

> Usa `DESIGN.md`, `apps/frontend/src/styles/design-tokens.css` y `apps/frontend/src/ui/` como contrato visual. Construye una interfaz editorial, accesible y orientada a busqueda/reutilizacion educativa. Reutiliza componentes existentes, evita colores o radios ad hoc, comprueba responsive y ejecuta `bun run design:lint` y `bun test`.

Referencia rapida:

- Accion primaria: `colors.primary`.
- Confirmacion o valor positivo: `colors.secondary`.
- Aviso editorial o pendiente: `colors.tertiary`.
- Error: `colors.error`.
- Fondo de pagina: `colors.background`.
- Tarjetas y paneles: `colors.surface-container-lowest` o `colors.surface-container-low`.
- Texto principal: `colors.on-surface`.
- Texto secundario: `colors.on-surface-variant`.

## Catalog Metadata

Si este contrato se muestra en una futura galeria interna de diseno, debe catalogarse con estos metadatos:

- Categoria: plataforma educativa publica / catalogo editorial.
- Estado: contrato raiz activo.
- Fuente operativa: `apps/frontend/src/styles/design-tokens.css`.
- Ultima revision: 2026-04-24.
- Validacion: `bun run design:lint`.
- Preview futura: swatches, escala tipografica, botones, inputs, chips, tarjetas de recurso, panel de filtros, estados editoriales y ejemplo responsive.

## Do

- Reutilizar tokens CSS existentes mediante `var(--token)`.
- Mantener la UI editorial, sobria y orientada a tareas.
- Priorizar lectura, busqueda, facetas, metadatos y acciones de reutilizacion.
- Documentar cualquier cambio de tokens en este fichero y en la feature/ADR correspondiente.
- Validar `bun run design:lint` y `bun test` antes de cerrar cambios de diseño.

## Do Not

- Crear paletas locales por pantalla.
- Introducir valores hexadecimales nuevos dentro de componentes sin token.
- Usar heroes o cards de marketing para flujos operativos.
- Sustituir componentes React existentes por HTML/CSS paralelo sin necesidad real.
- Confiar en `DESIGN.md` como unica fuente de verdad mientras la especificacion oficial siga en `alpha`.

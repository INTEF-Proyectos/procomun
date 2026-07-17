/**
 * Declaración de módulos CSS para TypeScript.
 * Vite importa `*.css` como side-effect (TS2882 sin esto).
 * Ver issue #282 / Fase 0 del burndown de tipos.
 */
declare module "*.css";

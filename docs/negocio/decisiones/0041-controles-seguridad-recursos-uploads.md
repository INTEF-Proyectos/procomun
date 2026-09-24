# ADR-0041 Controles de seguridad en recursos, ELPX y uploads

* Estado: Aceptado
* Fecha: 2026-09-06
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/arquitectura-solucion, @.agents/skills/backend-api-servicios, @.agents/skills/qa-validacion]

## Contexto y Problema

Una auditoría de seguridad detectó políticas divergentes entre APIs, expansión ELPX previa a los límites y endpoints susceptibles de abuso sostenido. Esto permite saltarse el ámbito de curación, actuar sobre borradores y agotar o distorsionar recursos compartidos.

El análisis se realizó con **Codex, modelo GPT-6**, usando el skill **`security-audit`**, revisión estática de flujos completos y validación adversarial independiente.

## Opciones Consideradas

* Corregir cada handler con reglas locales.
* Reutilizar políticas y límites existentes, añadiendo solo los controles compartidos que faltan.
* Introducir un gateway, rate limiter o almacenamiento externo.

## Decisión

Reutilizar la política canónica `canManageResource`, restringir las operaciones sociales a contenido publicado y adelantar los límites ELPX al primer acceso al ZIP. Las cuotas y deduplicación se aplican en servidor con las primitivas ya presentes en el proyecto.

## Consecuencias

### Positivas

* Una sola política de autorización gobierna backoffice y API con token.
* Los límites se aplican antes del consumo costoso.
* No se añaden dependencias ni infraestructura.

### Negativas / Riesgos

* Las métricas de descarga priorizan resistencia al abuso frente al conteo de repeticiones inmediatas.
* La cuota por defecto de 50 GiB debe ajustarse a la capacidad del despliegue.

## Notas de Implementación

Cada corrección incluye una prueba de regresión. La deduplicación de descargas usa una ventana de 60 segundos y la cuota acumulada de uploads es de 50 GiB por usuario; ambos valores son configurables por entorno. Las reservas concurrentes se serializan mediante advisory locks de PostgreSQL.

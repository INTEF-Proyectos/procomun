# Caso — Apertura segura de archivos `.elpx`

* Fecha: 2026-06-14
* Estado: Implementado
* ADR relacionado: [ADR-0026](../../negocio/decisiones/0026-apertura-segura-elpx.md)
* Tarea: `T-2026-06-14-001` (status.yaml)

## Problema público / educativo

Procomún ingiere y publica recursos `.elpx` (paquetes ZIP de eXeLearning) con HTML y JavaScript producidos por terceros. Ese contenido es **no confiable** y se muestra a cualquier visitante. Una apertura insegura del paquete o un renderizado con el origen autenticado de la plataforma compromete la seguridad de la sesión de los usuarios y la integridad del servidor, minando la confianza en una plataforma de recursos educativos abiertos.

## Origen del análisis

* `articulo-seguridad-exelearning` — análisis reproducible sobre la ejecución de HTML/JS de autor en LMS/CMS educativos. Tesis: el riesgo es ejecutar JS de autor **con el mismo origen autenticado** de la plataforma.
* `mod_exelearning_3` — plugin Moodle que ya implementa la apertura segura del ZIP (`classes/local/zip_utils.php`).

## Requisitos

### R1 — Extracción segura del ZIP
* R1.1 Rechazar entradas con nombre inseguro (zip slip): traversal `..`, ruta absoluta, backslash, esquema `scheme://`, nombre vacío.
* R1.2 Rechazar paquetes con enlaces simbólicos (antes y después de extraer).
* R1.3 Aplicar límites anti zip-bomb: número de entradas, tamaño total descomprimido y ratio de compresión.
* R1.4 Verificar tras extraer que todo el contenido quedó contenido en el directorio destino.
* R1.5 Hacer rollback (no dejar extracción parcial/insegura) ante cualquier fallo.

### R2 — Renderizado aislado (origen opaco)
* R2.1 Servir el HTML del `.elpx` con una CSP que incluya la directiva `sandbox` sin `allow-same-origin`.
* R2.2 Las vistas previas del frontend no deben conceder `allow-same-origin` al contenido de autor.
* R2.3 Preservar la interactividad del contenido (`allow-scripts`) sin exponer la sesión autenticada.
* R2.4 No romper el editor eXeLearning first-party (excepción consciente y documentada).

### R3 — Validación
* R3.1 Tests unitarios automatizados para R1 (zip slip, symlink, zip bomb, contención, rollback) y R2.1.
* R3.2 `bun test` en verde; paridad archivo-test (regla 16).

## Preguntas obligatorias (AGENTS.md)

1. **¿Qué problema resuelve?** Evita que un `.elpx` malicioso escriba fuera de su carpeta, agote el disco o ejecute JS con la sesión de la plataforma.
2. **¿Qué usuario se beneficia?** Todo visitante y la operación del servicio; la confianza pública en la plataforma.
3. **¿Datos mínimos del recurso?** Sin cambios en el modelo de datos; solo el endurecimiento del flujo de apertura/render.
4. **¿Qué tecnología?** TypeScript + Bun; inspección propia del directorio central del ZIP + `unzip` + CSP `sandbox`.
5. **¿Desarrollo propio?** Módulo `elpx-safe-extract.ts` (port de la lógica del plugin Moodle) y ajuste de CSP/iframes.
6. **¿Impacto en búsqueda/metadatos/moderación?** Nulo en metadatos; refuerza la moderación al contener contenido hostil.
7. **¿Cómo se valida?** Tests unitarios + verificación manual de cabeceras y origen opaco.
8. **¿Riesgo de lock-in?** Ninguno; sin dependencias nuevas. Evolución futura opcional a descompresor JS (`fflate`).

# Plantilla de ejecucion de pruebas manuales

> Plan asociado: `docs/casos/plan-pruebas-manuales-procomun-ng/README.md`
> Uso: duplicar este archivo para cada ronda de pruebas y rellenar los campos sin modificar el plan maestro.

## Datos de la ejecucion

| Campo | Valor |
|-------|-------|
| ID de ejecucion | `MANUAL-YYYY-MM-DD-NN` |
| Fecha inicio | `YYYY-MM-DD HH:mm` |
| Fecha fin | `YYYY-MM-DD HH:mm` |
| Responsable QA |  |
| Rama |  |
| Commit probado |  |
| Entorno | Local / Docker / Staging / Otro |
| URL frontend | `http://localhost:5173` |
| URL API | `http://localhost:3000` |
| Base de datos | PGlite / PostgreSQL / Otra |
| Seed ejecutado | Si / No |
| Comando de arranque | `make up` / otro |
| Navegador principal |  |
| Navegadores secundarios |  |
| Viewports probados | Desktop / Tablet / Mobile |
| Resultado global | Pendiente / Apto / Apto con riesgos / No apto |

## Cuentas usadas

| Rol | Email | Password | Probado | Observaciones |
|-----|-------|----------|---------|---------------|
| Admin | `admin@example.com` | `password` | No |  |
| Curator | `curator@example.com` | `password` | No |  |
| Editor | `editor@example.com` | `password` | No |  |
| Author | `author@example.com` | `password` | No |  |
| Reader | `reader@example.com` | `password` | No |  |
| Usuario creado durante QA |  |  | No |  |

## Checklist previa

| Check | Estado | Evidencia / notas |
|-------|--------|-------------------|
| `git status` revisado antes de arrancar | Pendiente |  |
| Dependencias disponibles | Pendiente |  |
| Seed ejecutado o base en estado conocido | Pendiente |  |
| API responde en `/health` | Pendiente |  |
| Frontend carga en `/` | Pendiente |  |
| DevTools abiertas con Console y Network | Pendiente |  |
| Capturas/evidencias preparadas | Pendiente |  |
| Criterio de limpieza de datos definido | Pendiente |  |

Estados permitidos: `OK`, `KO`, `Bloqueado`, `No aplica`, `Pendiente`.

## Resumen ejecutivo

| Metrica | Valor |
|---------|-------|
| Casos totales | 20 |
| Casos ejecutados | 0 |
| Casos OK | 0 |
| Casos KO | 0 |
| Casos bloqueados | 0 |
| Casos no aplica | 0 |
| Defectos S1 | 0 |
| Defectos S2 | 0 |
| Defectos S3 | 0 |
| Defectos S4 | 0 |

Conclusiones:

- 

Riesgos abiertos:

- 

Recomendacion:

- Apto / Apto con riesgos / No apto
- Motivo:

## Matriz de ejecucion por caso

| Caso | Area | Rol principal | Navegador/viewport | Estado | Evidencia | Defecto | Notas |
|------|------|---------------|--------------------|--------|-----------|---------|-------|
| MP-01 | Smoke tecnico del entorno | Anonimo |  | Pendiente |  |  |  |
| MP-02 | Navegacion publica e idioma | Anonimo |  | Pendiente |  |  |  |
| MP-03 | Home y descubrimiento inicial | Anonimo |  | Pendiente |  |  |  |
| MP-04 | Catalogo publico | Anonimo / Reader |  | Pendiente |  |  |  |
| MP-05 | Ficha publica de recurso | Anonimo / Reader |  | Pendiente |  |  |  |
| MP-06 | Login, logout y sesion | Reader / Author |  | Pendiente |  |  |  |
| MP-07 | Registro publico | Anonimo |  | Pendiente |  |  |  |
| MP-08 | Perfil personal y social ligero | Author / Reader |  | Pendiente |  |  |  |
| MP-09 | Creacion de recurso manual | Author |  | Pendiente |  |  |  |
| MP-10 | Flujo editorial por rol | Author / Editor / Curator / Admin |  | Pendiente |  |  |  |
| MP-11 | Uploads y adjuntos | Author / Curator |  | Pendiente |  |  |  |
| MP-12 | eXeLearning y `.elpx` | Author / Curator |  | Pendiente |  |  |  |
| MP-13 | Colecciones publicas | Anonimo |  | Pendiente |  |  |  |
| MP-14 | Backoffice: acceso y dashboard | Curator / Admin |  | Pendiente |  |  |  |
| MP-15 | Backoffice: recursos | Curator / Admin |  | Pendiente |  |  |  |
| MP-16 | Backoffice: colecciones | Curator / Admin |  | Pendiente |  |  |  |
| MP-17 | Backoffice: taxonomias | Curator / Admin |  | Pendiente |  |  |  |
| MP-18 | Backoffice: usuarios | Admin |  | Pendiente |  |  |  |
| MP-19 | Permisos y seguridad funcional | Varios |  | Pendiente |  |  |  |
| MP-20 | API smoke manual | Anonimo / Auth |  | Pendiente |  |  |  |

## Cobertura por navegador y dispositivo

| Area critica | Chromium desktop | Firefox desktop | Mobile 390x844 | Tablet 768x1024 | Resultado |
|--------------|------------------|-----------------|----------------|-----------------|-----------|
| Home | Pendiente | Pendiente | Pendiente | Pendiente |  |
| Catalogo | Pendiente | Pendiente | Pendiente | Pendiente |  |
| Ficha de recurso | Pendiente | Pendiente | Pendiente | Pendiente |  |
| Login/perfil | Pendiente | Pendiente | Pendiente | Pendiente |  |
| Editor de recurso | Pendiente | No aplica | Pendiente | Pendiente |  |
| Backoffice | Pendiente | Pendiente | Pendiente | Pendiente |  |
| Colecciones | Pendiente | Pendiente | Pendiente | Pendiente |  |

## Log de ejecucion detallado

Duplicar filas si un caso se ejecuta en varios navegadores, roles o viewports.

| Fecha/hora | Caso | Paso o escenario | Rol | Navegador | Viewport | Estado | Evidencia | Observaciones |
|------------|------|------------------|-----|-----------|----------|--------|-----------|---------------|
|  | MP-01 |  |  |  |  | Pendiente |  |  |

## Defectos encontrados

| ID defecto | Severidad | Caso | Titulo | Pasos de reproduccion | Resultado esperado | Resultado obtenido | Evidencia | Estado |
|------------|-----------|------|--------|-----------------------|--------------------|--------------------|-----------|--------|
| DEF-001 | S1/S2/S3/S4 | MP-XX |  |  |  |  |  | Nuevo |

Severidades:

- `S1 bloqueante`: impide login, carga principal, publicacion, datos o backoffice.
- `S2 alta`: rompe un flujo principal pero existe alternativa.
- `S3 media`: error funcional acotado, inconsistencia de permisos, validacion o persistencia.
- `S4 baja`: texto, estilo, accesibilidad menor o mejora UX.

Estados de defecto:

- `Nuevo`
- `Confirmado`
- `En correccion`
- `Corregido pendiente de retest`
- `Cerrado`
- `Aceptado como riesgo`
- `No reproducible`

## Evidencias

| ID evidencia | Tipo | Ruta / enlace | Caso | Descripcion |
|--------------|------|---------------|------|-------------|
| EV-001 | Captura / Video / HAR / Log / URL |  | MP-XX |  |

Convencion sugerida para nombres de archivo:

```text
manual-YYYY-MM-DD/MP-XX-descripcion-corta.png
manual-YYYY-MM-DD/MP-XX-descripcion-corta.har
manual-YYYY-MM-DD/MP-XX-descripcion-corta.webm
```

## Datos creados durante la prueba

| Tipo | Identificador | Creado por | Caso | Limpiar | Notas |
|------|---------------|------------|------|---------|-------|
| Recurso |  |  | MP-09/MP-10 | Si / No |  |
| Coleccion |  |  | MP-16 | Si / No |  |
| Taxonomia |  |  | MP-17 | Si / No |  |
| Usuario |  |  | MP-18 | Si / No |  |
| Archivo/upload |  |  | MP-11/MP-12 | Si / No |  |

## Checks de accesibilidad

| Pantalla | Teclado | Foco visible | Formularios y errores | Modal/foco | Zoom 200% | Estado | Defecto |
|----------|---------|--------------|-----------------------|------------|-----------|--------|---------|
| Home | Pendiente | Pendiente | No aplica | No aplica | Pendiente | Pendiente |  |
| Catalogo | Pendiente | Pendiente | Pendiente | No aplica | Pendiente | Pendiente |  |
| Ficha recurso | Pendiente | Pendiente | Pendiente | No aplica | Pendiente | Pendiente |  |
| Login | Pendiente | Pendiente | Pendiente | No aplica | Pendiente | Pendiente |  |
| Perfil | Pendiente | Pendiente | Pendiente | No aplica | Pendiente | Pendiente |  |
| Editor | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |  |
| Admin | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |  |

## Checks de rendimiento percibido

| Escenario | Medicion / percepcion | Umbral orientativo | Estado | Notas |
|-----------|-----------------------|--------------------|--------|-------|
| Home cold load |  | Contenido principal < 3s | Pendiente |  |
| Catalogo con seed |  | Primera lista < 3s | Pendiente |  |
| Cambio de filtro |  | Feedback inmediato y resultados < 2s | Pendiente |  |
| Ficha con `.elpx` |  | Metadatos primero; iframe no bloquea | Pendiente |  |
| Admin recursos |  | Tabla inicial < 3s | Pendiente |  |
| Upload pequeno |  | Progreso visible < 1s | Pendiente |  |

## Defectos esperables del plan

Marcar el resultado real para confirmar o descartar sospechas ya documentadas.

| Riesgo | Caso | Resultado real | Defecto |
|--------|------|----------------|---------|
| `/registro` puede estar usando login en lugar de alta real. | MP-07 | Pendiente |  |
| Bio de perfil puede no persistir. | MP-08 | Pendiente |  |
| Boton eliminar usuario puede no tener endpoint backend. | MP-18 | Pendiente |  |
| Ordenacion visible del catalogo puede no estar conectada a backend. | MP-04 | Pendiente |  |
| Materias/niveles pueden no estar como facetas principales. | MP-04/MP-05 | Pendiente |  |

## Retest

Usar esta seccion si se ejecuta la plantilla para verificar correcciones.

| Defecto | Caso | Commit con correccion | Resultado retest | Evidencia | Cierre |
|---------|------|-----------------------|------------------|-----------|--------|
| DEF-001 | MP-XX |  | Pendiente |  |  |

## Cierre

| Criterio | Estado | Notas |
|----------|--------|-------|
| Todos los S1 estan cerrados o aceptados formalmente | Pendiente |  |
| Todos los S2 tienen decision | Pendiente |  |
| Los flujos MP-01 a MP-06 estan OK | Pendiente |  |
| El flujo MP-09 -> MP-10 -> MP-05 esta OK | Pendiente |  |
| Backoffice critico MP-14 a MP-18 esta OK o con riesgos aceptados | Pendiente |  |
| Mobile smoke completado | Pendiente |  |
| Evidencias enlazadas | Pendiente |  |
| Datos de prueba limpiados o documentados | Pendiente |  |
| Resultado global decidido | Pendiente |  |

Decision de cierre:

- Resultado: Apto / Apto con riesgos / No apto
- Responsable:
- Fecha:
- Comentarios:

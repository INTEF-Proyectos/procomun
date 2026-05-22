# Plantilla de ejecucion de pruebas manuales

> Plan asociado: `docs/casos/plan-pruebas-manuales-procomun-ng/README.md`
> Uso: duplicar este archivo para cada ronda de pruebas y rellenar solo lo ejecutado.

## Datos de la prueba

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
| Viewports probados | Desktop / Tablet / Mobile |
| Preparacion del entorno | Pendiente / OK / Fallo |
| Resultado global | Pendiente / Apto / Apto con riesgos / No apto |
| Observaciones generales |  |

Estados recomendados para los casos: `OK`, `Fallo`, `Pendiente`, `Bloqueado`, `No aplica`.

## Matriz de ejecucion por caso

| Caso | Area | Rol principal | Navegador/viewport | Estado | Defecto | Notas |
|------|------|---------------|--------------------|--------|---------|-------|
| MP-01 | Smoke tecnico del entorno | Anonimo |  | Pendiente |  |  |
| MP-02 | Navegacion publica e idioma | Anonimo |  | Pendiente |  |  |
| MP-03 | Home y descubrimiento inicial | Anonimo |  | Pendiente |  |  |
| MP-04 | Catalogo publico | Anonimo / Reader |  | Pendiente |  |  |
| MP-05 | Ficha publica de recurso | Anonimo / Reader |  | Pendiente |  |  |
| MP-06 | Login, logout y sesion | Reader / Author |  | Pendiente |  |  |
| MP-07 | Registro publico | Anonimo |  | Pendiente |  |  |
| MP-08 | Perfil personal y social ligero | Author / Reader |  | Pendiente |  |  |
| MP-09 | Creacion de recurso manual | Author |  | Pendiente |  |  |
| MP-10 | Flujo editorial por rol | Author / Editor / Curator / Admin |  | Pendiente |  |  |
| MP-11 | Uploads y adjuntos | Author / Curator |  | Pendiente |  |  |
| MP-12 | eXeLearning y `.elpx` | Author / Curator |  | Pendiente |  |  |
| MP-13 | Colecciones publicas | Anonimo |  | Pendiente |  |  |
| MP-14 | Backoffice: acceso y dashboard | Curator / Admin |  | Pendiente |  |  |
| MP-15 | Backoffice: recursos | Curator / Admin |  | Pendiente |  |  |
| MP-16 | Backoffice: colecciones | Curator / Admin |  | Pendiente |  |  |
| MP-17 | Backoffice: taxonomias | Curator / Admin |  | Pendiente |  |  |
| MP-18 | Backoffice: usuarios | Admin |  | Pendiente |  |  |
| MP-19 | Permisos y seguridad funcional | Varios |  | Pendiente |  |  |
| MP-20 | API smoke manual | Anonimo / Auth |  | Pendiente |  |  |

## Defectos encontrados

| ID defecto | Severidad | Caso | Titulo | Pasos de reproduccion | Resultado esperado | Resultado obtenido | Estado / notas |
|------------|-----------|------|--------|-----------------------|--------------------|--------------------|----------------|
| DEF-001 | S1/S2/S3/S4 | MP-XX |  |  |  |  | Nuevo |

Severidades:

- `S1 bloqueante`: impide login, carga principal, publicacion, datos o backoffice.
- `S2 alta`: rompe un flujo principal pero existe alternativa.
- `S3 media`: error funcional acotado, inconsistencia de permisos, validacion o persistencia.
- `S4 baja`: texto, estilo, accesibilidad menor o mejora UX.

# Ejecucion de pruebas manuales - 2026-05-22

> Plan asociado: `docs/casos/plan-pruebas-manuales-procomun-ng/README.md`
> Plantilla asociada: `docs/casos/plan-pruebas-manuales-procomun-ng/plantilla-ejecucion.md`

## Datos de la prueba

| Campo | Valor |
|-------|-------|
| ID de ejecucion | `MANUAL-2026-05-22-01` |
| Fecha inicio | `2026-05-22 17:12` |
| Fecha fin | Pendiente |
| Responsable QA | Juanda |
| Rama | `main` |
| Commit probado | `3928363996ed78f1f68d47253492cf05167a9f0f` |
| Entorno | Local |
| URL frontend | `http://localhost:5173` |
| URL API | `http://localhost:3000` |
| Base de datos | PGlite |
| Seed ejecutado | Si |
| Comando de arranque | `make up` |
| Navegador principal | Chrome |
| Viewports probados | Desktop |
| Preparacion del entorno | OK |
| Resultado global | Pendiente |
| Observaciones generales | Pruebas en curso. Ya hay defectos detectados en ficha de recurso y permisos de acceso a `/admin`. |

Estados recomendados para los casos: `OK`, `Fallo`, `Pendiente`, `Bloqueado`, `No aplica`.

## Matriz de ejecucion por caso

| Caso | Area | Rol principal | Navegador/viewport | Estado | Defecto | Notas |
|------|------|---------------|--------------------|--------|---------|-------|
| MP-01 | Smoke tecnico del entorno | Anonimo | Chrome / Desktop | OK |  |  |
| MP-02 | Navegacion publica e idioma | Anonimo | Chrome / Desktop | OK |  |  |
| MP-03 | Home y descubrimiento inicial | Anonimo | Chrome / Desktop | OK |  |  |
| MP-04 | Catalogo publico | Anonimo / Reader | Chrome / Desktop | OK |  |  |
| MP-05 | Ficha publica de recurso | Anonimo / Reader | Chrome / Desktop | Fallo | DEF-003 | El contador de descargas no se incrementa. |
| MP-06 | Login, logout y sesion | Reader / Author | Chrome / Desktop | Fallo | DEF-004 | Reader, author o editor pueden acceder a `/admin`. |
| MP-07 | Registro publico | Anonimo | Chrome / Desktop | Fallo |  |  |
| MP-08 | Perfil personal y social ligero | Author / Reader | Chrome / Desktop | OK |  |  |
| MP-09 | Creacion de recurso manual | Author | Chrome / Desktop | Pendiente |  |  |
| MP-10 | Flujo editorial por rol | Author / Editor / Curator / Admin | Chrome / Desktop | Pendiente |  |  |
| MP-11 | Uploads y adjuntos | Author / Curator | Chrome / Desktop | Pendiente |  |  |
| MP-12 | eXeLearning y `.elpx` | Author / Curator | Chrome / Desktop | Pendiente |  |  |
| MP-13 | Colecciones publicas | Anonimo | Chrome / Desktop | Pendiente |  |  |
| MP-14 | Backoffice: acceso y dashboard | Curator / Admin | Chrome / Desktop | Pendiente |  |  |
| MP-15 | Backoffice: recursos | Curator / Admin | Chrome / Desktop | Pendiente |  |  |
| MP-16 | Backoffice: colecciones | Curator / Admin | Chrome / Desktop | Pendiente |  |  |
| MP-17 | Backoffice: taxonomias | Curator / Admin | Chrome / Desktop | Pendiente |  |  |
| MP-18 | Backoffice: usuarios | Admin | Chrome / Desktop | Pendiente |  |  |
| MP-19 | Permisos y seguridad funcional | Varios | Chrome / Desktop | Pendiente |  |  |
| MP-20 | API smoke manual | Anonimo / Auth | Chrome / Desktop | Pendiente |  |  |

## Defectos encontrados

| ID defecto | Severidad | Caso | Titulo | Pasos de reproduccion | Resultado esperado | Resultado obtenido | Estado / notas |
|------------|-----------|------|--------|-----------------------|--------------------|--------------------|----------------|
| DEF-001 | S4 | Todos | Error intermitente en consola | Navegar por la aplicacion durante la ejecucion manual. | No aparecen errores no controlados en consola. | Aparece intermitentemente: `Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received`. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/152> |
| DEF-002 | S4 | Todos | Warning de sandbox en iframe | Navegar por pantallas con iframes o previews. | No aparecen warnings de seguridad relevantes en consola. | Aparece intermitentemente: `An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.` | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/153> |
| DEF-003 | S2 | MP-05 | El contador de descargas no funciona | Descargar un recurso desde la ficha publica. | Se incrementa el contador de descargas. | No se incrementa el contador. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/154> |
| DEF-004 | S1 | MP-06 | Reader, author o editor pueden entrar en `/admin` | Hacer login como reader, author o editor y navegar a `/admin`. | No se debe entrar en el panel de administracion. | Se entra en el panel de administracion. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/155> |
| DEF-005 | S1 | MP-07 | No se puede crear cuenta | Introducir datos validos para registro y hacer clic en crear cuenta. | Se debe crear la cuenta y redirigir a perfil. | Siempre aparece el mensaje de error `invalid email or password`. | GitHub: <https://github.com/INTEF-Proyectos/procomun/issues/156> |

Severidades:

- `S1 bloqueante`: impide login, carga principal, publicacion, datos o backoffice.
- `S2 alta`: rompe un flujo principal pero existe alternativa.
- `S3 media`: error funcional acotado, inconsistencia de permisos, validacion o persistencia.
- `S4 baja`: texto, estilo, accesibilidad menor o mejora UX.

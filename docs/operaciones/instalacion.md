# Guía de Instalación y Despliegue

Esta guía detalla los pasos necesarios para desplegar Procomun utilizando Docker.

## Requisitos del sistema

### Hardware
- **CPU**: Mínimo 2 cores (recomendado 4 cores).
- **RAM**: Mínimo 4 GB (recomendado 8 GB).
- **Almacenamiento**: Mínimo 20 GB de espacio libre (dependiendo del volumen de recursos educativos y uploads).

### Software
- **Docker**: Engine v24+
- **Docker Compose**: v2.20+
- **Sistema Operativo**: Linux (Ubuntu 22.04 LTS recomendado) o macOS.

### Red
- Puertos abiertos: 80 (HTTP), 443 (HTTPS).
- Acceso a internet para descarga de imágenes de registro (GHCR).

## Instalación paso a paso

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/intef-proyectos/procomun.git
   cd procomun
   ```

2. **Configurar variables de entorno**
   Copia el archivo de ejemplo y edítalo con tus credenciales:
   ```bash
   cp .env.example .env
   nano .env
   ```

3. **Desplegar con Docker Compose**
   ```bash
   docker compose up -d
   ```

4. **Inicializar base de datos y semilla (opcional)**
   ```bash
   docker compose run --rm seed
   ```

## Catálogo de Variables de Entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `DATABASE_URL` | URL de conexión a PostgreSQL | `postgres://user:pass@db:5432/procomun` |
| `BETTER_AUTH_SECRET` | Secreto para firma de sesiones (32+ chars) | Obligatorio |
| `FRONTEND_URL` | URL del frontend para CORS | `http://localhost:5173` |
| `BETTER_AUTH_URL` | URL pública de la API para redirecciones de Auth | `http://localhost:3000` |
| `UPLOAD_STORAGE_DIR` | Directorio local para almacenamiento de archivos | `./local-data/uploads` |
| `OIDC_ENABLED` | Activar autenticación OIDC | `false` |
| `OIDC_END_SESSION_URL` | Cierre de sesión del proveedor; vacía, se lee `end_session_endpoint` del documento de descubrimiento (#542) | vacía |

## Configuración de PostgreSQL

La base de datos se despliega como un servicio `db` en Docker Compose utilizando la imagen `postgres:17-alpine`. Los datos se persisten en un volumen llamado `pgdata`.

## Configuración de Almacenamiento

Los archivos subidos se guardan localmente en el directorio configurado mediante `UPLOAD_STORAGE_DIR`. Se recomienda montar un volumen dedicado para esta ruta en el servicio `api`.

## Configuración de Proveedores OIDC

Procomun soporta OpenID Connect para login institucional. Requiere configurar `OIDC_ISSUER`, `OIDC_CLIENT_ID` y `OIDC_CLIENT_SECRET` en el archivo `.env`.

En el proveedor de identidad hay que dar de alta como URL de retorno (redirect URI) `{BETTER_AUTH_URL}/api/auth/callback/oidc`. Hasta Better Auth 1.6 era `{BETTER_AUTH_URL}/api/auth/oauth2/callback/oidc`; un despliegue registrado con esa tiene que cambiarla (ADR-0007, #527).

## Enlace al banco multimedia (2026-11-16, #569)

Procomún no tiene banco multimedia propio: enlaza con la aplicación del banco (decisión 1 de #494).

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `MEDIA_BANK_URL` | URL absoluta `http://` o `https://` de la aplicación del banco multimedia | Sin definir |

- La lee la API y la publica en `GET /api/v1/config` como `mediaBankUrl`, así que no hay que reconstruir el frontend. Con Docker Compose, el servicio `app` la toma de `.env`; tras cambiarla, recrea el contenedor con `docker compose up -d app`. `docker compose restart app` no basta: conserva el entorno con el que se creó el contenedor.
- Con valor, aparece el enlace «Banco multimedia» en la cabecera, junto a «Explorar», y un aviso con «Ir al banco multimedia» en `/nuevo`. Se abre en la misma pestaña.
- Sin definir, vacía, sin `//` tras el esquema (`https:banco.example.org`) o con otro esquema (`javascript:`, `ftp:`, una ruta relativa…), `mediaBankUrl` vale `null` y el enlace no aparece. Si es válida, se publica normalizada (`HTTPS://Banco.Example.org` → `https://banco.example.org/`).
- En pantallas de menos de 768 px los enlaces de la cabecera, incluido este, están ocultos, como «Explorar».

# Despliegue

## Cloudflare Pages

Conservar el repositorio como directorio raíz del build. Usar `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @bj/web build` como comando y `apps/web/dist` como directorio de salida. Configurar:

- `PUBLIC_SITE_URL`: la URL productiva actual de Pages.
- `PUBLIC_API_BASE_URL`: `https://bj-<ip-publica>.sslip.io/api/v1` mientras no exista dominio propio.

Los previews deben usar el mismo API. Añadir sus orígenes exactos a `WEB_ORIGINS`; no habilitar `*`. Crear un Deploy Hook y guardarlo únicamente en `CLOUDFLARE_DEPLOY_HOOK` del stack privado para que un cambio de catálogo regenere también el HTML de SEO.

## Aislamiento en Dockploy

Crear un proyecto nuevo llamado `bj-burgers`; no reutilizar volúmenes ni variables del servicio de correo. PostgreSQL permanece solo en `bj_burgers_private`. La API se conecta también a `dokploy-network` exclusivamente para recibir tráfico de Traefik, sin publicar puertos del host.

Hostname provisional recomendado: `bj-<ip-publica-con-guiones>.sslip.io`. Configurar la ruta `/` hacia el puerto interno `4100`; el API vive en `/api/v1` y el panel compilado en `/admin`.

## Variables obligatorias

- `DATABASE_URL`
- `WEB_ORIGINS`: URL productiva de Cloudflare y previews explícitamente permitidas.
- `PUBLIC_APP_ORIGIN`
- `CODE_HMAC_SECRET`
- `SESSION_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `CLOUDFLARE_DEPLOY_HOOK` (opcional, recomendado)

Generar el hash del administrador con `pnpm --filter @bj/api admin:hash -- "contraseña"`. No conservar la contraseña en variables después de crear la cuenta.

Después del primer despliegue, abrir la consola del contenedor API y ejecutar una sola vez:

```sh
pnpm --filter @bj/api db:migrate
pnpm --filter @bj/api db:seed
```

El dominio nativo de Dockploy debe apuntar al servicio `api`, puerto interno `4100`, con HTTPS. Revisar `Preview Compose` antes de desplegar para confirmar que solo la API se agrega al proxy. No publicar el puerto de PostgreSQL y no unir `bj_burgers_private` a ninguna red del correo.

La semilla es de solo inserción: si ya existe un registro, no modifica ajustes hechos desde el panel ni la contraseña del administrador. No usarla como mecanismo para cambiar datos existentes.

## Migración y salida

No hay códigos vigentes que importar. Ejecutar migraciones y semilla, confirmar que la ruleta de prueba no es canjeable y crear códigos reales nuevos solo después de validar respaldos. Desplegar una preview de Cloudflare y ejecutar las pruebas E2E antes del cambio productivo.

## Respaldo

Crear un bucket privado `bj-burgers-backups` en Oracle Object Storage, región Monterrey, con una regla de ciclo de vida que elimine objetos después de 14 días. Usar un usuario/clave API dedicado con permisos limitados a este bucket; no reutilizar credenciales de otros servicios.

En el host, `scripts/backup-postgres.sh` toma `pg_dump` exclusivamente del contenedor `bj-burgers-db`, cifra el flujo sin escribir un dump en claro y lo sube con la imagen oficial de OCI CLI. Requiere `BACKUP_DESTINATION`, `BACKUP_ENCRYPTION_PASSWORD_FILE`, `OCI_CONFIG_DIR`, `OCI_NAMESPACE`, `OCI_BUCKET_NAME` y `OCI_CLI_IMAGE` fijada por digest. Guardar los secretos fuera del repositorio, restringidos a root; programar el script diariamente y alertar si falla. El archivo local cifrado solo se borra después de verificar el objeto remoto.

Antes del lanzamiento, descargar una copia en un entorno temporal, descifrarla y restaurarla en una base temporal de B&J. Comparar conteos de productos, códigos, saldo total y canjes; borrar el dump descifrado al terminar. No usar las funciones de restauración global de Dokploy, pues afectarían otros proyectos.

## Rollback

No borrar el proyecto anterior de Pages ni la exportación previa de Supabase. Si falla el flujo real, volver el alias productivo al último deployment sano de Pages y dejar el stack nuevo en solo lectura para diagnóstico. No importar de nuevo el mismo CSV sin comparar antes conteos y saldo.

# Despliegue

## Cloudflare Pages

Conservar el repositorio como directorio raíz del build. Usar `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @bj/web build` como comando y `apps/web/dist` como directorio de salida. Configurar:

- `PUBLIC_SITE_URL`: la URL productiva actual de Pages.
- `PUBLIC_API_BASE_URL`: `https://bj-<ip-publica>.sslip.io/api/v1` mientras no exista dominio propio.

Los previews deben usar el mismo API. Añadir sus orígenes exactos a `WEB_ORIGINS`; no habilitar `*`. Crear un Deploy Hook y guardarlo únicamente en `CLOUDFLARE_DEPLOY_HOOK` del stack privado para que un cambio de catálogo regenere también el HTML de SEO.

## Aislamiento en Dockploy

Crear un proyecto nuevo llamado `bj-burgers`; no reutilizar redes, volúmenes ni variables del servicio de correo. El stack solo publica el contenedor `api` mediante el proxy administrado por Dockploy. PostgreSQL permanece en la red privada.

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

Después del primer despliegue, abrir la consola del contenedor API y ejecutar:

```sh
pnpm --filter @bj/api db:migrate
pnpm --filter @bj/api db:seed
```

El proxy de Dockploy debe apuntar al puerto interno `4100`. No publicar el puerto de PostgreSQL y no unir `bj_burgers_private` a ninguna red del correo.

## Migración y salida

1. Exportar `spin_codes` desde Supabase a CSV y conservar una copia cifrada.
2. Ejecutar migraciones y semilla.
3. Importar con `pnpm --filter @bj/api codes:import -- ruta/al/archivo.csv`.
4. Comparar cantidad de códigos, activos y suma de giros antes del corte.
5. Desplegar una preview de Cloudflare y ejecutar las pruebas E2E.
6. Mantener Supabase en solo lectura hasta validar los primeros canjes.

## Respaldo

Programar `scripts/backup-postgres.ps1` o su equivalente Linux para ejecutar `pg_dump`, cifrar el archivo, copiarlo fuera del volumen principal y borrar copias con más de 14 días. Realizar una restauración de prueba antes del lanzamiento.

En Linux, `scripts/backup-postgres.sh` requiere `DATABASE_URL`, `BACKUP_DESTINATION` y `BACKUP_ENCRYPTION_PASSWORD`. El destino debe ser un montaje o almacenamiento externo a `bj_burgers_db`. Programarlo diariamente y vigilar su código de salida.

Antes del lanzamiento, descifrar una copia en un entorno temporal, restaurarla con `pg_restore --clean --if-exists --no-owner` y comparar conteos de productos, códigos, saldo total y canjes. El archivo descifrado debe borrarse al terminar la prueba.

## Rollback

No borrar el proyecto anterior de Pages ni la exportación previa de Supabase. Si falla el flujo real, volver el alias productivo al último deployment sano de Pages y dejar el stack nuevo en solo lectura para diagnóstico. No importar de nuevo el mismo CSV sin comparar antes conteos y saldo.

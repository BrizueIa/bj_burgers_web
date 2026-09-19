# Pruebas con PostgreSQL y recorridos operativos

Las pruebas de concurrencia y las migraciones usan una base de PostgreSQL 17
aislada. Nunca apuntes `TEST_DATABASE_URL` a la base de desarrollo o producción:
el test reinicia el esquema `public`. El validador exige que el nombre de la base
termine en `test`.

En PowerShell, inicia la base efímera y configura el entorno de pruebas:

```powershell
docker compose -f compose.test.yaml up -d --wait
$env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/bj_burgers_test'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:NODE_ENV = 'development' # necesario para que Playwright inicie la API
$env:WEB_ORIGINS = 'http://127.0.0.1:5173,http://127.0.0.1:4322'
$env:PUBLIC_APP_ORIGIN = 'http://127.0.0.1:4322'
$env:CODE_HMAC_SECRET = 'pruebas-locales-codigo-de-al-menos-32-caracteres'
$env:SESSION_SECRET = 'pruebas-locales-sesion-de-al-menos-32-caracteres'
$env:ADMIN_EMAIL = 'admin.test@bjburgers.local'
$env:ADMIN_PASSWORD = 'contrasena-de-pruebas'
pnpm --filter @bj/api test:postgres
pnpm e2e
docker compose -f compose.test.yaml down -v
```

`pnpm e2e` migra y siembra esa base, inicia API y administración, y ejecuta el
sitio público y el panel en escritorio, teléfono y tablet. En CI los mismos
valores se definen exclusivamente dentro del workflow.

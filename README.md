# B&J Burgers Platform

Plataforma modular para el sitio público, carrito a WhatsApp, panel administrativo y canje seguro de la ruleta.

## Estructura

- `apps/web`: sitio público Astro (`/`, `/menu`, `/ruleta`).
- `apps/admin`: panel privado React.
- `apps/api`: API Fastify y PostgreSQL.
- `apps/mobile`: operación Android con React Native y Expo.
- `packages/contracts`: contratos, catálogo inicial y reglas compartidas.
- `packages/api-client`: cliente tipado compartido para la API operativa.

## Desarrollo local

1. Copia `.env.example` a `.env` y ajusta los valores.
2. Ejecuta `pnpm install`.
3. Inicia PostgreSQL con `docker compose up -d db`.
4. Ejecuta `pnpm --filter @bj/api db:migrate` y `pnpm --filter @bj/api db:seed`.
5. Inicia los procesos con `pnpm dev:api`, `pnpm dev:web` y `pnpm dev:admin`.

Usa `pnpm dev:mobile` para abrir la operación React Native. `pnpm check` valida formato, lint, tipos, pruebas, builds y el bundle Android de Expo. `pnpm e2e` reconstruye la web y ejecuta Playwright en escritorio y móvil.

Consulta [la guía de migración Android](docs/MOBILE_MIGRATION.md) para desarrollar, vincular y generar el APK de `apps/mobile`.

Consulta [TESTING.md](docs/TESTING.md) para levantar PostgreSQL aislado y ejecutar las pruebas de concurrencia y los recorridos de administración.

Consulta [ARCHITECTURE.md](docs/ARCHITECTURE.md), [BRANCHING.md](docs/BRANCHING.md), [CONTRIBUTING.md](docs/CONTRIBUTING.md), [GITHUB_SETUP.md](docs/GITHUB_SETUP.md) y el [plan del POS](docs/POS_IMPLEMENTATION_PLAN.md) antes de cambiar o desplegar la plataforma.

La web se publica como contenido estático en Cloudflare Pages. API, panel y PostgreSQL se despliegan como un proyecto independiente en Dockploy usando `compose.yaml`. Consulta `docs/DEPLOYMENT.md` antes de desplegar.

# B&J Burgers Platform

Plataforma modular para el sitio público, carrito a WhatsApp, panel administrativo y canje seguro de la ruleta.

## Estructura

- `apps/web`: sitio público Astro (`/`, `/menu`, `/ruleta`).
- `apps/admin`: panel privado React.
- `apps/api`: API Fastify y PostgreSQL.
- `packages/contracts`: contratos, catálogo inicial y reglas compartidas.

## Desarrollo local

1. Copia `.env.example` a `.env` y ajusta los valores.
2. Ejecuta `pnpm install`.
3. Inicia PostgreSQL con `docker compose up -d db`.
4. Ejecuta `pnpm --filter @bj/api db:migrate` y `pnpm --filter @bj/api db:seed`.
5. Inicia los procesos con `pnpm dev:api`, `pnpm dev:web` y `pnpm dev:admin`.

`pnpm check` valida formato, lint, tipos, pruebas y builds de todo el workspace. `pnpm e2e` reconstruye la web y ejecuta Playwright en escritorio y móvil.

La web se publica como contenido estático en Cloudflare Pages. API, panel y PostgreSQL se despliegan como un proyecto independiente en Dockploy usando `compose.yaml`. Consulta `docs/DEPLOYMENT.md` antes de desplegar.

# Arquitectura de B&J Burgers

B&J es un monorepo pnpm. Las aplicaciones activas viven en `apps/`; los paquetes que comparten contratos o lógica sin interfaz viven en `packages/`.

| Área                  | Responsabilidad                                  | Fuente de verdad             |
| --------------------- | ------------------------------------------------ | ---------------------------- |
| `apps/web`            | Sitio público, menú, carrito y ruleta            | API pública                  |
| `apps/admin`          | Catálogo, ajustes y dispositivos                 | API administrativa           |
| `apps/api`            | Reglas de negocio, autenticación y PostgreSQL    | PostgreSQL                   |
| `apps/mobile`         | Operación Android: comandas y negocio            | API de operador              |
| `packages/contracts`  | Tipos, validaciones Zod y reglas de carrito      | Código TypeScript compartido |
| `packages/api-client` | Cliente autenticado, errores, idempotencia y SSE | Contratos y API              |

## Reglas de dependencia

- Las interfaces nunca consultan PostgreSQL directamente.
- Las reglas definitivas de precio, inventario, estados y ruleta se ejecutan en `apps/api` dentro de transacciones.
- `packages/contracts` no depende de aplicaciones ni de React Native.
- `packages/api-client` no depende de componentes visuales y valida respuestas antes de exponerlas.
- Una app puede consumir paquetes de `packages/`, pero no importar código fuente de otra app.
- Las variables privadas viven fuera de Git. Las variables públicas de Expo sólo pueden contener información apta para distribuirse en la app.

## Operación y despliegue

La web pública se publica en Cloudflare Pages. API, panel y PostgreSQL se despliegan juntos en Dockploy; consulta [DEPLOYMENT.md](DEPLOYMENT.md). La app móvil se valida en CI como bundle Android y sólo genera APK firmados mediante el workflow manual de GitHub.

## Flutter legado

`bjburgers_app` permanece fuera de este repositorio como respaldo de la instalación actual. No recibe funciones nuevas. Tras validar la actualización React Native, se debe conservar un commit y tag de su última versión funcional, marcarlo como archivado y mantener este monorepo como única fuente para desarrollo activo.

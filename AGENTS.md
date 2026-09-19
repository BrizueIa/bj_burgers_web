# Reglas de trabajo para B&J Burgers

Este repositorio es un monorepo: `apps/web` contiene el sitio y la administración, `apps/mobile` la app React Native/Expo, `packages/*` los contratos y el cliente compartido, y `apps/api` la API. Un cambio de negocio puede tocar más de una de estas áreas, pero debe conservar contratos y reglas de negocio en el servidor.

## Flujo obligatorio

1. Antes de modificar, parte de `main` actualizado: comprueba que el árbol esté limpio, cambia a `main` y ejecuta `git pull --ff-only`.
2. No hagas commits ni pushes directos a `main`. Crea una rama corta con el prefijo adecuado:
   - `feature/` para funcionalidad nueva.
   - `fix/` para corregir comportamiento integrado.
   - `chore/` para documentación, dependencias, herramientas o CI.
   - `release/` sólo para estabilizar una entrega excepcional.
3. Mantén el cambio y el pull request enfocados. No combines una función nueva con refactors, actualizaciones de dependencias o cambios ajenos.
4. Ejecuta `pnpm check` antes de abrir el pull request. Ejecuta también `pnpm e2e` cuando afecte el sitio web o sus recorridos públicos. Corrige los fallos antes de continuar.
5. Abre un pull request hacia `main` con qué cambió, por qué y cómo se validó. Espera los checks obligatorios de GitHub: `Quality and Android bundle` y `Web end-to-end`.
6. Antes de integrar, deja el pull request actualizado con `main`, resuelve sus conversaciones y confirma que los checks sigan en verde. Usa **squash merge** y elimina la rama integrada.

GitHub protege `main`: no admite pushes directos, force-push ni eliminación; la regla también aplica a administradores. Consulta [docs/BRANCHING.md](docs/BRANCHING.md) y [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md) para el detalle de la política.

## Reglas de la app móvil

- Conserva el identificador Android `com.bjburgers.operacion`, la marca B&J, español y MXN.
- Las reglas definitivas de negocio permanecen en la API. La app no confirma operaciones ni calcula costos definitivos por su cuenta.
- No modifiques el repositorio Flutter de referencia `../bjburgers_app` salvo que se pida de forma explícita.
- Para una entrega Android, cambia `version` y `android.versionCode` mediante pull request y usa el workflow manual de release sólo cuando estén disponibles los secretos de firma originales. No sustituyas la clave ni cambies el identificador para evitar un bloqueo de actualización.

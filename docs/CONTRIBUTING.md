# Contribuir a B&J Burgers

## Antes de cambiar código

1. Crea una rama corta desde `main` con el prefijo adecuado: `feature/`, `fix/` o `chore/`.
2. Mantén un cambio enfocado: API, interfaz, contrato o infraestructura, sin combinar refactors sin relación.
3. Si cambias una ruta o un payload, actualiza primero `packages/contracts`, después la API y finalmente sus consumidores.
4. Añade una migración nueva para cada cambio persistente; nunca edites una migración ya aplicada.

## Comandos

```powershell
pnpm install
pnpm dev:api
pnpm dev:web
pnpm dev:admin
pnpm dev:mobile
pnpm check
```

`pnpm check` verifica formato, lint, tipos, pruebas, builds y el bundle Android de Expo. Para recorridos visuales de la web usa `pnpm e2e`.

## Pull requests

- Explica el comportamiento final, la validación realizada y cualquier efecto sobre datos o despliegue.
- No incluyas secretos, APKs, AABs, keystores, dumps, archivos `.env` ni resultados de build.
- Incluye la migración y prueba asociada cuando cambies datos o una regla del servidor.
- Espera CI verde antes de integrar a `main`; cuando haya más de un responsable, cumple también la revisión requerida.
- Usa squash merge y elimina la rama después de integrar el pull request.

Consulta [BRANCHING.md](BRANCHING.md) para las reglas de ramas, releases, hotfixes y tags.

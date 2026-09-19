# Estrategia de ramas

El monorepo usa desarrollo basado en `main`: no hay una rama permanente por aplicación ni una rama `develop`. Web, API, administración y móvil se integran mediante cambios pequeños y revisables contra la misma línea de producción.

## Ramas permanentes

| Rama   | Propósito                                                          | Regla                                              |
| ------ | ------------------------------------------------------------------ | -------------------------------------------------- |
| `main` | Código listo para desplegar y para generar el APK de actualización | Protegida; sólo recibe pull requests con CI verde. |

## Ramas de trabajo

Crea cada rama desde el `main` actualizado y elimínala después del merge.

| Prefijo    | Uso                                                      | Ejemplo                      |
| ---------- | -------------------------------------------------------- | ---------------------------- |
| `feature/` | Función nueva que puede tocar una o varias apps          | `feature/inventario-compras` |
| `fix/`     | Corrección de un comportamiento ya integrado             | `fix/reintento-comanda`      |
| `chore/`   | Dependencias, herramientas, documentación o CI           | `chore/android-release-ci`   |
| `release/` | Estabilización excepcional de una entrega de varios días | `release/mobile-1.0.2`       |

No se crean ramas por área como `mobile`, `api` o `web`: una función de negocio suele requerir contratos, API e interfaz y debe llegar integrada. Si dos cambios no dependen entre sí, se hacen en ramas y pull requests separados.

## Integración y entregas

1. Actualiza `main`, crea la rama y mantén el pull request enfocado.
2. Ejecuta `pnpm check`; ejecuta `pnpm e2e` cuando afecte la web pública.
3. El pull request debe quedar actualizado con `main` y pasar los checks requeridos; cuando haya más de un responsable, también debe recibir la revisión requerida.
4. Usa **squash merge** para que cada pull request se integre como un cambio rastreable.
5. Elimina la rama ya integrada.

Para un hotfix, usa `fix/` desde `main` y sigue el mismo proceso de pull request. Sólo crea `release/` cuando sea necesario congelar una versión mientras cambios no relacionados siguen entrando a `main`; cualquier corrección hecha ahí se integra también a `main` antes de publicar.

## Versiones y tags

Un tag identifica el commit que realmente se desplegó, nunca una rama de trabajo. Para entregas independientes usa nombres claros, por ejemplo `mobile-v1.0.2`, `api-v1.4.0` o `web-v1.3.0`. El APK Android se construye desde el commit de `main` etiquetado y con su `android.versionCode` incrementado.

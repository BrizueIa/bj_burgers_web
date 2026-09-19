# Configuración de GitHub

## Protección de `main`

En **Settings → Branches**, protege `main` con estos requisitos:

- Pull request obligatorio antes de merge.
- Al menos una aprobación, incluyendo revisión de propietario para rutas cubiertas por `CODEOWNERS`.
- Checks obligatorios: `Quality and Android bundle` y `Web end-to-end`.
- Conversaciones resueltas y ramas actualizadas antes de merge.
- Sin force push ni eliminación de la rama.

No crees una protección adicional para una rama `develop`: el flujo usa `main` protegido y ramas de trabajo cortas. Consulta [BRANCHING.md](BRANCHING.md) para los prefijos, releases y hotfixes.

## Secretos del release Android

En el entorno GitHub `production`, agrega estos secretos:

| Secreto                        | Contenido                                                                |
| ------------------------------ | ------------------------------------------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`      | Archivo `.jks` original codificado en Base64, sin saltos de línea extra. |
| `BJ_ANDROID_KEYSTORE_PASSWORD` | Contraseña del almacén.                                                  |
| `BJ_ANDROID_KEY_ALIAS`         | Alias de la clave.                                                       |
| `BJ_ANDROID_KEY_PASSWORD`      | Contraseña de la clave.                                                  |

El workflow **Android release** se ejecuta sólo de forma manual. Antes de lanzarlo, incrementa `version` y `android.versionCode` en `apps/mobile/app.json` mediante un pull request. Descarga el APK, instálalo sobre la app Flutter de referencia sin desinstalar y vuelve a vincular el dispositivo.

## Flujo de trabajo

1. Crea una rama desde `main`.
2. Abre pull request; CI valida backend, web y bundle Android.
3. Integra sólo con los checks verdes.
4. Para una entrega Android, actualiza versión, integra el PR y ejecuta el workflow manual desde `main`.

No se publicará automáticamente en Play Store hasta configurar su cuenta, pistas de distribución y proceso de aprobación.

# B&J Operación en Android

La aplicación React Native está en `apps/mobile`. Reemplaza la interfaz Flutter y conserva el servidor, las comandas y los datos existentes. Las credenciales de Flutter no se migran porque están cifradas por la plataforma; después de instalar la actualización, vincula el dispositivo otra vez desde el panel.

## Desarrollo y validación

Desde la raíz del monorepo:

```powershell
pnpm --filter @bj/mobile start
pnpm --filter @bj/mobile typecheck
pnpm --filter @bj/mobile test
pnpm --filter @bj/mobile exec expo install --check
```

Para usar la API local en un dispositivo físico, inicia Expo con `EXPO_PUBLIC_API_BASE_URL` apuntando a una URL HTTPS accesible desde ese dispositivo. El valor incluido por defecto apunta a la API de producción actual; no coloques secretos en esa variable.

## APK y actualización instalada

El identificador Android es `com.bjburgers.operacion` y el `versionCode` inicial de React Native es `2`. Una actualización de Android solo funciona cuando está firmada con la misma clave que firmó la app Flutter instalada.

Antes de generar un APK release, recupera y guarda fuera del repositorio la clave de firma original. Define estas variables sólo en la terminal de compilación:

```powershell
$env:BJ_ANDROID_KEYSTORE = 'C:\ruta-segura\bj-operacion.jks'
$env:BJ_ANDROID_KEYSTORE_PASSWORD = '...'
$env:BJ_ANDROID_KEY_ALIAS = '...'
$env:BJ_ANDROID_KEY_PASSWORD = '...'
pnpm --filter @bj/mobile build:android
```

El script genera el proyecto Android local, escribe propiedades de firma ignoradas por Git, construye el APK y elimina esas propiedades. Si falta una variable o el archivo, se detiene sin producir un release que no pueda actualizar la app actual. Para una compilación de desarrollo sin firma de actualización:

```powershell
pnpm --filter @bj/mobile build:android -Variant debug
```

Instala primero la versión Flutter de referencia en un dispositivo de prueba y registra su certificado y `versionCode`. Después instala el APK React Native sin desinstalar. Verifica que Android muestre una actualización, abre B&J Operación, vincula el dispositivo de nuevo y confirma que ve las mismas comandas del servidor.

## Matriz de sustitución

| Función Flutter            | React Native                                            | Validación                                     |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| Vinculación de dispositivo | SecureStore y pantalla de vinculación                   | Nueva vinculación y sesión revocada            |
| Comandas y filtros         | Listado, detalle y panel tablet                         | Crear, filtrar y consultar historial           |
| Importar WhatsApp          | Interpretar, corregir y confirmar borrador              | Extras, ingredientes removidos, combos y notas |
| Estados y ruleta           | Cambio de estado, emisión, copiar y compartir           | Flujo nueva → entregada y reintento del código |
| Negocio                    | Inicio, POS, inventario, recetas, caja y reportes       | Compra, comanda, cobro, merma, gasto y receta  |
| Actualizaciones            | SSE con reconexión y consulta cada 20 s en primer plano | Cambio desde otro dispositivo                  |

El POS de compras, proveedores, inventario, recetas, producción, comandas,
cobros, caja, gastos y rentabilidad ya está integrado en `apps/mobile` y usa la
API como fuente de verdad. Los PR de cada entrega están enlazados en la
[matriz de trazabilidad](POS_TRACEABILITY.md); el check de CI compila el bundle Expo, pero todavía
falta recorrer la matriz en teléfono y tablet Android. Antes de activar el
circuito unificado, concilia inventario, prueba la restauración de una copia
aislada y cierra o cancela las comandas pendientes del circuito anterior.
Consulta [POS_IMPLEMENTATION_PLAN.md](POS_IMPLEMENTATION_PLAN.md),
[POS_OPERATIONS.md](POS_OPERATIONS.md) y [POS_TRACEABILITY.md](POS_TRACEABILITY.md)
para el proceso de activación y sus evidencias.

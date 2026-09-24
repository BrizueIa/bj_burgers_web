# Operación del POS B&J

Guía para el local y ensayo seguro de despliegue. Todas las cantidades se expresan en MXN y las fechas operativas en `America/Mexico_City`. El servidor y PostgreSQL confirman precios, disponibilidad, caja y estados; un mensaje de error o una pantalla sin confirmación no constituye una operación registrada.

## Uso diario

1. En la administración web o en el Android vinculado, abre **Caja** e inicia el turno con el fondo contado. Sólo se permite un turno abierto.
2. En **Inventario**, revisa existencia, reservas y disponibilidad. Registra conteos o mermas con su motivo. No registres otra vez una existencia inicial que ya está en el libro mayor.
3. En **Compras**, confirma proveedor, presentación, equivalencia, cantidades, descuentos, gastos de adquisición, medio y origen del pago. Elige caja sólo cuando el dinero salga del turno abierto.
4. En **Recetas**, activa versiones completas antes de producir o vender productos que requieran inventario. Usa **Producción** desde la app móvil para registrar rendimiento real y merma.
5. En **Vender**, agrega partidas y cotiza. Si aplicas un descuento manual, registra también su motivo; el servidor impide superar el total después de promociones y fija el reparto en las partidas. Revisa el total devuelto por el servidor y confirma sólo después de aceptar la cotización vigente. Domicilio requiere nombre, colonia y dirección.
6. En **Comandas**, cambia el estado conforme sucede la operación. Para mostrador, **Cobrar y entregar** registra ambos efectos juntos. Cualquier entrega exige saldo cero. Las devoluciones se ligan a un pago original y pueden limitarse a una partida; conserva el motivo y el ticket descargado o compartido desde la comanda persistida.
7. Importa mensajes de WhatsApp desde **Comandas** y resuelve las líneas que el sistema no pueda reconocer. La importación crea una comanda del mismo circuito POS y conserva el texto fuente.
8. Registra gastos con medio y origen correctos. Registra una comisión vinculada al pago original para que no duplique costos.
9. Al cierre, cuenta el efectivo, registra entradas/salidas faltantes y cierra el turno con el importe contado y una nota cuando exista diferencia.
10. Consulta **Reportes** por fechas locales. El CSV contiene el detalle completo aunque la tabla se pagine. Las ventas se reconocen al entregar; cobros anticipados aparecen separados. Los reembolsos se reconocen en el periodo en que se efectúan.

## Activación y contingencia

- Habilita capacidades desde **Activación POS**, siguiendo sus dependencias y las comprobaciones del servidor. El corte unificado sólo se permite cuando la base está preparada y no quedan comandas antiguas pendientes.
- Antes del corte, concilia inventario, caja y comandas abiertas; conserva una copia de la base y registra qué commits de API, administración y Android se van a desplegar.
- Después del corte, no vuelvas a habilitar escritores antiguos. Si falla una función, detén nuevas escrituras de esa capacidad y conserva el acceso de lectura. No restaures una copia sobre una base que recibió operaciones posteriores.
- Ante respuesta de red incierta, reintenta la misma acción y conserva los datos del formulario. La clave de idempotencia recupera el resultado anterior; no generes otra operación para resolver la duda.

## Ensayo de respaldo y restauración

Ejecuta estos comandos con PostgreSQL Client Tools instalado y credenciales disponibles en la sesión segura del operador. Usa una base de ensayo aislada; no apuntes los comandos de restauración a producción.

```powershell
$backupFile = Join-Path $env:TEMP "bj-pos-rehearsal-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
pg_dump --format=custom --no-owner --file $backupFile $env:DATABASE_URL
pg_restore --list $backupFile | Select-Object -First 20
createdb bj_pos_restore_rehearsal
pg_restore --no-owner --dbname bj_pos_restore_rehearsal $backupFile
```

En la base restaurada, valida que las migraciones estén completas, el catálogo y las capacidades coincidan con la copia, y que inventario, compras, comandas, pagos, reembolsos, turnos, gastos y tickets tengan los mismos totales que antes del respaldo. Luego ejecuta las pruebas contra esa base aislada. Registra fecha, commit, versión de PostgreSQL, nombre de la copia, resultados y duración. El ensayo queda aprobado sólo cuando la API puede consultar la base restaurada y los conteos y saldos conciliados coinciden.

Al terminar, elimina exclusivamente la base aislada `bj_pos_restore_rehearsal` y el archivo temporal de ese ensayo después de guardar su evidencia. Nunca automatices una restauración destructiva sobre producción.

## Entrega Android

La aplicación mantiene el identificador `com.bjburgers.operacion` y debe firmarse con la clave original configurada en los secretos del workflow de release. Incrementa `expo.version` y `expo.android.versionCode` mediante el cambio revisado de entrega. Si faltan la clave o los secretos originales, registra el bloqueo; no generes otra clave ni cambies el identificador para forzar una actualización.

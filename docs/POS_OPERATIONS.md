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

El check `Quality and Android bundle` ejecuta un ensayo automático con PostgreSQL 17 y datos sintéticos: genera un `pg_dump`, restaura en una base temporal única y compara conteos de todas las tablas públicas más saldos de inventario, comandas, pagos y reembolsos. El script sólo acepta una URL local cuyo nombre termina en `_test`; nunca apunta a producción. Esta prueba protege el procedimiento, pero no sustituye el ensayo operacional con una copia aislada del local.

Antes de habilitar `pos_cutover`, el responsable de infraestructura debe tomar una copia de la base real siguiendo la política vigente de respaldos, restaurarla en una instancia aislada con la misma versión mayor de PostgreSQL y validar lecturas de API, migraciones, catálogo, existencias y saldos. Registrar fecha, commit, versión de PostgreSQL, identificador de copia, resultados y duración. No guardar credenciales ni datos personales en la evidencia del PR. No restaurar sobre producción ni sobre una instancia que haya recibido operaciones posteriores.

Para una prueba manual, usa credenciales obtenidas por el canal seguro del operador y una instancia/base desechable que no contenga información de clientes. Define `POS_REHEARSAL_SOURCE_URL` sólo con la URL de esa base de ensayo local terminada en `_test`, y ejecuta `bash scripts/rehearse-postgres-restore.sh` desde Bash con Docker disponible. El ensayo crea una base con nombre aleatorio y la elimina al terminar; el respaldo y los resultados permanecen en `POS_REHEARSAL_ARTIFACT_DIR` para revisar y luego borrar de forma segura.

```powershell
$env:POS_REHEARSAL_SOURCE_URL = 'postgres://usuario:clave@localhost:5432/bj_pos_rehearsal_test'
$env:POS_REHEARSAL_ARTIFACT_DIR = Join-Path $env:TEMP 'bj-pos-backup-rehearsal'
bash scripts/rehearse-postgres-restore.sh
```

El ensayo queda aprobado sólo cuando la restauración termina sin errores y los conteos y saldos coinciden. El directorio de artefactos contiene una copia de respaldo completa; restringe su acceso y elimínalo al concluir la revisión.

## Entrega Android

La aplicación mantiene el identificador `com.bjburgers.operacion` y debe firmarse con la clave original configurada en los secretos del workflow de release. Incrementa `expo.version` y `expo.android.versionCode` mediante el cambio revisado de entrega. Si faltan la clave o los secretos originales, registra el bloqueo; no generes otra clave ni cambies el identificador para forzar una actualización.

El check `Quality and Android bundle` verifica que Expo genere el bundle Android; no ejecuta la app en un teléfono/tablet ni produce una actualización firmada. Antes de activar el POS en dispositivos, completa y registra recorridos de vender, comandas, inventario/producción, caja, reportes, pérdida de conexión/reintento y sincronización con un segundo equipo en Android real o emulador. El workflow manual `Android release` requiere el entorno `production` y la llave original en los cuatro secretos que indica el workflow.

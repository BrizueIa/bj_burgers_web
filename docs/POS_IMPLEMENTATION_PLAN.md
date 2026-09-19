# Sistema integral POS de B&J

## Estado de partida

La plataforma usa React Native/Expo en `apps/mobile`, React en `apps/admin`, Astro en `apps/web`, Fastify en `apps/api` y PostgreSQL como fuente de verdad. El repositorio Flutter vecino es sólo referencia de la instalación anterior y no recibe cambios. La aplicación Android conserva `com.bjburgers.operacion`.

Ya existen ingredientes, recetas simples, movimientos de negocio, comandas, ruleta y una aplicación de operación básica. Las ventas de inventario y las comandas aún son circuitos separados; esta iniciativa los reemplaza por una operación única y conserva ambos historiales sin inventar cobros o costos.

## Reglas invariables

- La API aplica precios, existencias, estados, costos y transacciones. Los clientes sólo muestran datos confirmados por ella.
- Toda confirmación usa una clave idempotente persistida con su resultado. Reintentar la misma solicitud devuelve ese resultado; una solicitud distinta con la misma clave produce conflicto.
- Cantidades se almacenan como `numeric(16,3)`, costos internos como `numeric` y montos definitivos como centavos enteros. Los contratos intercambian decimales como texto.
- Un movimiento confirmado no se edita ni se borra: las correcciones generan una operación compensatoria trazable.
- No se permiten existencias negativas. Las reservas, los consumos y las salidas se coordinan en una transacción con bloqueos de PostgreSQL.
- Una receta, precio, costo y composición se fijan para cada operación. Los cambios posteriores no reescriben el historial.
- Hay una caja compartida y sólo un turno abierto. Cobros y reembolsos exigen turno abierto; entregar exige saldo pendiente igual a cero.
- Un reembolso puede ser total o parcial y no repone inventario automáticamente.

## Cálculos contables

Entradas de inventario se valoran con el costo de adquisición distribuido entre partidas; salidas con promedio ponderado. Un lote de preparación recibe el costo de sus insumos consumidos y lo distribuye entre el rendimiento realmente obtenido. El precio sugerido es `costo directo / (1 - margen objetivo)` y nunca modifica el precio de lista por sí solo.

Una venta se reconoce al entregar. La utilidad bruta es ventas netas menos costo vendido; la contribución resta comisiones; el resultado operativo también resta gastos y mermas. Las compras son inventario, no gasto de rentabilidad. Pagos y flujo de efectivo se reportan por separado.

## Entregas y activación

| Entrega        | Capacidades                                                 | Activación                                                                                           |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Base           | Inventario, proveedores, compras, recetas y producción      | Habilitar sólo después de conciliar saldos existentes y usar un único libro de movimientos.          |
| Operación      | Comandas unificadas, POS, pagos, caja, reembolsos y tickets | Habilitar después de cerrar o cancelar comandas antiguas pendientes y validar respaldo/restauración. |
| Administración | Gastos, rentabilidad, reportes y CSV                        | Habilitar cuando los totales de detalle, exportación y caja concilien.                               |

Código integrado, función habilitada y versión desplegada son estados distintos. Si falla una activación, se deshabilitan las nuevas escrituras afectadas y se preservan los datos para diagnóstico; nunca se reactiva un escritor antiguo que ignore las nuevas invariantes.

## Secuencia de trabajo

1. `chore/pos-plan`: este documento, matriz de trazabilidad y correcciones de documentación.
2. `chore/pos-integration-tests`: PostgreSQL aislado en CI, migraciones y concurrencia obligatorias, E2E para administración y tamaños tablet.
3. `feature/pos-foundation`: actores, contratos decimales, capacidades, idempotencia y correspondencia de esquema.
4. `feature/stock-ledger`, `feature/purchasing`, `feature/recipe-versions` y `feature/production`: primera entrega.
5. `feature/unified-orders`, `feature/cash-sessions`, `feature/payments-refunds`, `feature/pos-tickets` y `feature/pos-cutover`: segunda entrega.
6. `feature/expenses`, `feature/profitability-reports` y `chore/pos-release`: tercera entrega y evidencia de lanzamiento.

Cada rama parte de `main` actualizado, incluye contratos antes que consumidores, migraciones nuevas en vez de editar las aplicadas, pruebas relevantes, `pnpm check` y `pnpm e2e` cuando cambia un recorrido web o administrativo. Cada PR se integra por squash a `main` sólo con los checks `Quality and Android bundle` y `Web end-to-end` en verde.

## Límites de la primera versión

Un local, MXN y `America/Mexico_City`; conexión obligatoria; mostrador, recoger y domicilio. Quedan fuera mesas, sucursales, crédito, facturación fiscal, impresoras, terminales, IA y automatización de WhatsApp. Se conserva la importación manual de WhatsApp y el vínculo entre comanda y ruleta.

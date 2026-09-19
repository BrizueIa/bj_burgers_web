# Matriz de trazabilidad del POS

Esta matriz se actualiza al integrar cada PR. Una fila se considera completada sólo cuando su evidencia enlaza el PR integrado y una prueba automatizada o procedimiento verificable.

| Requisito                                                           | Entrega / rama                  | Evidencia requerida                                                                                             | Estado    |
| ------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| Contratos, actor autenticado, capacidades, decimales e idempotencia | `feature/pos-foundation`        | Pruebas de contrato, API y reintento con respuesta perdida                                                      | Pendiente |
| PostgreSQL en CI, migraciones y concurrencia sin omisiones          | `chore/pos-integration-tests`   | Workflow, servicio PostgreSQL y pruebas que fallan sin `TEST_DATABASE_URL`                                      | Pendiente |
| Inventario inicial, reservas, conteos, ajustes y mermas             | `feature/stock-ledger`          | Migración desde datos existentes y pruebas de saldo no negativo                                                 | Pendiente |
| Proveedores, presentaciones, compras y prorrateos                   | `feature/purchasing`            | Compra multipartida con descuento/gasto y reversión trazable                                                    | Pendiente |
| Recetas versionadas, extras, removibles, combos y costos            | `feature/recipe-versions`       | Ciclos rechazados; historial de receta y costo estable                                                          | Pendiente |
| Preparaciones por lote                                              | `feature/production`            | 200 g consumidos, 150 g obtenidos y costo de $0.20/g                                                            | Pendiente |
| Comanda/venta única, cotización, reserva y consumo                  | `feature/unified-orders`        | Dos equipos compiten por la última existencia; sólo uno confirma                                                | Pendiente |
| Apertura, movimientos y cierre de caja                              | `feature/cash-sessions`         | Un único turno abierto y efectivo esperado reconciliado                                                         | Pendiente |
| Pagos combinados, cambio y reembolsos                               | `feature/payments-refunds`      | Venta de $100 con $40 en tarjeta y $100 en efectivo: $40 de cambio, $100 netos cobrados ($60 netos en efectivo) | Pendiente |
| Tickets y actualización entre equipos                               | `feature/pos-tickets`           | Ticket persistido, reintento y actualización tras reconectar                                                    | Pendiente |
| Corte al POS unificado                                              | `feature/pos-cutover`           | Históricos legibles y escritores antiguos bloqueados                                                            | Pendiente |
| Gastos y comisiones                                                 | `feature/expenses`              | Medio/origen y efecto único en caja y rentabilidad                                                              | Pendiente |
| Rentabilidad, reportes y CSV                                        | `feature/profitability-reports` | Más de 200 registros, límites de periodo y CSV conciliado                                                       | Pendiente |
| Respaldo, restauración y Android firmado                            | `chore/pos-release`             | Ensayo restaurado y workflow con firma original                                                                 | Pendiente |

## Criterios de aceptación transversales

- La misma clave idempotente no duplica compras, reservas, consumos, cobros, reembolsos o movimientos de caja; una clave reutilizada con contenido distinto no cambia datos.
- Cancelar antes de preparar libera reservas. Cancelar después de preparar registra una merma única; un pago ya realizado queda como reembolso pendiente.
- Entregar con saldo pendiente falla; cobrar y entregar en mostrador confirma ambos efectos de forma atómica.
- Reabastecer o editar una receta no altera ventas históricas. Una devolución posterior reduce ingresos, conserva el costo vendido y no crea crédito.
- Los reportes usan intervalos locales convertidos a UTC `[desde, hasta)`, se paginan sin truncar agregados y permiten explicar cada total mediante detalle.
- Todas las aplicaciones conservan formularios ante una falla de red y sólo muestran confirmación tras una respuesta válida del servidor.

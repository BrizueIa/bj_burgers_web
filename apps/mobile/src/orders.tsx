import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BjApiError, createIdempotencyKey } from '@bj/api-client';
import type {
  Catalog,
  Order,
  OrderDraft,
  OrderStatus,
  OrderTicket,
  UnifiedOrderConfirm,
} from '@bj/contracts';
import { api } from './api';
import { centsFromInput, money, statusLabel } from './format';
import { useForeground } from './hooks';
import { Button, Card, Field, Loading, Notice, Pill, ScrollScreen, SectionTitle } from './ui';
import { colors, shared } from './theme';

const statuses: Array<OrderStatus | 'all'> = [
  'all',
  'new',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
];
const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

function useOrders(filter: OrderStatus | 'all') {
  const foreground = useForeground();
  return useQuery({
    queryKey: ['orders', filter],
    queryFn: () => api.orders(filter === 'all' ? undefined : filter),
    refetchInterval: foreground ? 20_000 : false,
    refetchIntervalInBackground: false,
  });
}

function useOrderStream(enabled: boolean) {
  const queryClient = useQueryClient();
  const foreground = useForeground();
  useEffect(() => {
    if (!enabled || !foreground) return;
    const controller = new AbortController();
    let retry = 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        await api.subscribeOrderEvents(
          (orderId) => {
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
            void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
          },
          controller.signal,
          () => {
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
          },
        );
        retry = 1_000;
      } catch (cause) {
        if (cause instanceof BjApiError && cause.unauthorized) return;
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(() => void connect(), retry);
        retry = Math.min(retry * 2, 30_000);
      }
    };
    void connect();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, foreground, queryClient]);
}

function StatusPill({ status }: { status: string }) {
  return (
    <View
      style={[
        styles.status,
        status === 'cancelled' && styles.cancelled,
        status === 'delivered' && styles.delivered,
      ]}
    >
      <Text style={styles.statusText}>{statusLabel(status)}</Text>
    </View>
  );
}

function htmlEscape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function ticketHtml(ticket: OrderTicket) {
  const { order } = ticket;
  const items = order.items
    .map(
      (item) =>
        `<tr><td>${item.quantity} × ${htmlEscape(item.productName)}${item.note ? `<br><small>${htmlEscape(item.note)}</small>` : ''}</td><td>${money(item.lineTotalCents)}</td></tr>`,
    )
    .join('');
  const payments = ticket.payments
    .map(
      (payment) =>
        `<li>${{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[payment.method]}: ${money(payment.appliedCents)}</li>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial,sans-serif;color:#181818;padding:24px}h1{text-align:center;font-size:22px}p{text-align:center;color:#555}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:9px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right;white-space:nowrap}.total{font-weight:bold;font-size:18px;text-align:right}small{color:#555}</style></head><body><h1>B&amp;J Burgers</h1><p>Ticket ${htmlEscape(ticket.id.slice(0, 8).toUpperCase())}<br>${new Date(ticket.issuedAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p><p>${htmlEscape(order.customerName || 'Mostrador')} · ${htmlEscape(order.fulfillment)}</p><table>${items}</table>${order.manualDiscountCents > 0 ? `<p>Descuento ${money(order.manualDiscountCents)} · ${htmlEscape(order.manualDiscountReason)}</p>` : ''}<p class="total">Total ${money(order.totalCents)}</p><p>Pagos</p><ul>${payments}</ul><p>Gracias por tu compra</p></body></html>`;
}

function OrdersList({
  orders,
  selectedId,
  onSelect,
}: {
  orders: Order[];
  selectedId?: string;
  onSelect(order: Order): void;
}) {
  if (!orders.length)
    return (
      <View style={styles.empty}>
        <Text style={shared.subtitle}>No hay comandas en este estado.</Text>
      </View>
    );
  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {orders.map((order) => (
        <Card key={order.id} style={[styles.orderCard, selectedId === order.id && styles.selected]}>
          <Text style={shared.text}>
            {order.customerName || 'Sin nombre'} · {money(order.totalCents)}
          </Text>
          <StatusPill status={order.status} />
          <Text style={shared.subtitle}>
            {order.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}
            {order.neighborhood ? `\n${order.neighborhood}` : ''}
          </Text>
          <Button label="Abrir" secondary onPress={() => onSelect(order)} />
        </Card>
      ))}
    </ScrollView>
  );
}

export function OrdersBoard() {
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const { data: orders = [], isLoading, error, refetch, isFetching } = useOrders(filter);
  const [selectedId, setSelectedId] = useState<string>();
  const { width } = useWindowDimensions();
  const tablet = width >= 760;
  useOrderStream(true);
  if (isLoading) return <Loading label="Cargando comandas…" />;
  return (
    <View style={shared.screen}>
      <View style={shared.content}>
        <SectionTitle
          title="Comandas"
          action={
            <Button
              label={isFetching ? 'Actualizando…' : 'Actualizar'}
              secondary
              disabled={isFetching}
              onPress={() => void refetch()}
            />
          }
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {statuses.map((status) => (
            <Pill
              key={status}
              label={status === 'all' ? 'Todas' : statusLabel(status)}
              selected={filter === status}
              onPress={() => {
                setFilter(status);
                setSelectedId(undefined);
              }}
            />
          ))}
        </ScrollView>
        {error ? (
          <Notice kind="error">
            {error instanceof BjApiError ? error.message : 'No se pudieron cargar las comandas.'}
          </Notice>
        ) : null}
      </View>
      <View style={styles.orderLayout}>
        {tablet ? (
          <>
            <View style={styles.orderListPane}>
              <OrdersList
                orders={orders}
                selectedId={selectedId}
                onSelect={(order) => setSelectedId(order.id)}
              />
            </View>
            <View style={styles.detailPane}>
              {selectedId ? (
                <OrderDetailPanel orderId={selectedId} embedded />
              ) : (
                <View style={styles.empty}>
                  <Text style={shared.subtitle}>Selecciona una comanda para ver su detalle.</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <OrdersList
            orders={orders}
            onSelect={(order) =>
              router.push({ pathname: '/(app)/orders/[id]', params: { id: order.id } })
            }
          />
        )}
      </View>
      <View style={styles.floating}>
        <Button label="Nueva venta · POS" onPress={() => router.push('/(app)/pos')} />
        <Button
          label="Importar de WhatsApp"
          secondary
          onPress={() => router.push('/(app)/orders/import')}
        />
      </View>
    </View>
  );
}

export function OrderDetailPanel({
  orderId,
  embedded = false,
}: {
  orderId: string;
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const {
    data: order,
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: ['order', orderId], queryFn: () => api.order(orderId) });
  const capabilitiesQuery = useQuery({
    queryKey: ['pos-capabilities'],
    queryFn: () => api.capabilities(),
  });
  const unifiedOrdersEnabled =
    capabilitiesQuery.data?.some((item) => item.key === 'unified_orders' && item.enabled) === true;
  const paymentsEnabled =
    capabilitiesQuery.data?.some((item) => item.key === 'payments_refunds' && item.enabled) ===
    true;
  const ticketsEnabled =
    capabilitiesQuery.data?.some((item) => item.key === 'pos_tickets' && item.enabled) === true;
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [received, setReceived] = useState('');
  const [checkoutSplitMethod, setCheckoutSplitMethod] = useState<
    'none' | 'cash' | 'card' | 'transfer'
  >('none');
  const [checkoutSplitAmount, setCheckoutSplitAmount] = useState('');
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundOrderItemId, setRefundOrderItemId] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const paymentKey = useRef<{ request: string; key: string } | undefined>(undefined);
  const checkoutKey = useRef<{ request: string; key: string } | undefined>(undefined);
  const refundKey = useRef<{ request: string; key: string } | undefined>(undefined);
  const spinKey = useRef<string | undefined>(undefined);
  const ticketKey = useRef<string | undefined>(undefined);
  const statusKey = useRef<{ status: OrderStatus; key: string } | undefined>(undefined);
  const change = useMutation({
    mutationFn: (status: OrderStatus) => {
      if (statusKey.current && statusKey.current.status !== status)
        throw new BjApiError('Reintenta primero la actualización pendiente con los mismos datos.');
      if (!statusKey.current) statusKey.current = { status, key: createIdempotencyKey() };
      return api.updateOrderStatus(orderId, status, '', statusKey.current.key);
    },
    onSuccess: async () => {
      statusKey.current = undefined;
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
    onError: (cause) => {
      if (cause instanceof BjApiError && !cause.ambiguous) statusKey.current = undefined;
      setMessage(cause instanceof BjApiError ? cause.message : 'No se pudo cambiar el estado.');
    },
  });
  const collectPayment = async () => {
    setMessage(undefined);
    const cents = centsFromInput(received);
    const appliedCents = Math.min(cents, order?.balanceCents ?? 0);
    const request = JSON.stringify({ orderId, paymentMethod, receivedCents: cents, appliedCents });
    if (paymentKey.current && paymentKey.current.request !== request) {
      setMessage('Reintenta primero el cobro pendiente con los mismos datos.');
      return;
    }
    if (!paymentKey.current) paymentKey.current = { request, key: createIdempotencyKey() };
    try {
      const result = await api.collectOrderPayment(orderId, {
        idempotencyKey: paymentKey.current.key,
        payments: [
          {
            method: paymentMethod,
            receivedCents: cents,
            appliedCents,
          },
        ],
      });
      paymentKey.current = undefined;
      setReceived('');
      setMessage('Cobro confirmado. Saldo pendiente: ' + money(result.balanceCents));
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    } catch (cause) {
      if (cause instanceof BjApiError && !cause.ambiguous) paymentKey.current = undefined;
      setMessage(cause instanceof BjApiError ? cause.message : 'No se pudo confirmar el cobro.');
    }
  };
  const checkoutCounter = async () => {
    if (!order || order.fulfillment !== 'counter' || order.status !== 'ready') return;
    const receivedCents = centsFromInput(received);
    const splitAppliedCents =
      checkoutSplitMethod === 'none' ? 0 : centsFromInput(checkoutSplitAmount);
    const primaryAppliedCents = order.balanceCents - splitAppliedCents;
    if (
      primaryAppliedCents <= 0 ||
      receivedCents < primaryAppliedCents ||
      (paymentMethod !== 'cash' && receivedCents !== primaryAppliedCents) ||
      (checkoutSplitMethod !== 'none' && splitAppliedCents <= 0)
    ) {
      setMessage(
        'Revisa los importes: los medios electrónicos deben coincidir con lo aplicado y el total debe cubrir el saldo.',
      );
      return;
    }
    const payments = [
      { method: paymentMethod, receivedCents, appliedCents: primaryAppliedCents },
      ...(checkoutSplitMethod === 'none'
        ? []
        : [
            {
              method: checkoutSplitMethod,
              receivedCents: splitAppliedCents,
              appliedCents: splitAppliedCents,
            },
          ]),
    ];
    const request = JSON.stringify({
      orderId,
      payments,
    });
    if (checkoutKey.current && checkoutKey.current.request !== request) {
      setMessage('Reintenta primero el cobro y entrega pendiente con los mismos datos.');
      return;
    }
    if (!checkoutKey.current) checkoutKey.current = { request, key: createIdempotencyKey() };
    setMessage(undefined);
    try {
      const result = await api.checkoutCounterOrder(orderId, {
        idempotencyKey: checkoutKey.current.key,
        payments,
      });
      checkoutKey.current = undefined;
      setReceived('');
      setCheckoutSplitAmount('');
      setCheckoutSplitMethod('none');
      setMessage(`Cobro y entrega confirmados. Cambio: ${money(result.changeCents)}.`);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    } catch (cause) {
      if (cause instanceof BjApiError && !cause.ambiguous) checkoutKey.current = undefined;
      setMessage(
        cause instanceof BjApiError
          ? cause.message
          : 'No se pudo confirmar. Reintenta la misma solicitud.',
      );
    }
  };
  const issueSpin = async () => {
    setMessage(undefined);
    spinKey.current ??= createIdempotencyKey();
    try {
      const result = await api.issueSpinCode(orderId, spinKey.current);
      setMessage(`Código de ruleta: ${result.code}${result.reused ? ' (recuperado)' : ''}`);
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    } catch (cause) {
      setMessage(
        cause instanceof BjApiError
          ? cause.message
          : 'No se pudo emitir el código. Reintenta para recuperar el mismo código.',
      );
    }
  };
  const copyOrShare = async () => {
    if (!message?.startsWith('Código de ruleta: ')) return;
    const code = message.replace(/^Código de ruleta:\s*/, '').replace(/\s\(recuperado\)$/, '');
    await Clipboard.setStringAsync(code);
    await Share.share({ message: `Tu código de ruleta B&J: ${code}` });
  };
  const shareTicket = async () => {
    setMessage(undefined);
    ticketKey.current ??= createIdempotencyKey();
    try {
      const { ticket } = await api.issueOrderTicket(orderId, {
        idempotencyKey: ticketKey.current,
      });
      ticketKey.current = undefined;
      const file = await Print.printToFileAsync({ html: ticketHtml(ticket) });
      if (!(await Sharing.isAvailableAsync())) {
        setMessage(`Ticket guardado en ${file.uri}`);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Compartir ticket B&J',
        UTI: 'com.adobe.pdf',
      });
      setMessage('Ticket PDF generado desde los datos confirmados.');
    } catch (cause) {
      setMessage(
        cause instanceof BjApiError
          ? cause.message
          : 'No se pudo generar el ticket. Reintenta para recuperar el mismo ticket.',
      );
    }
  };
  const refundPayment = async () => {
    if (!order) return;
    const amountCents = centsFromInput(refundAmount);
    const payment = order.payments.find((item) => item.id === refundPaymentId);
    if (
      !payment ||
      amountCents <= 0 ||
      amountCents > payment.refundableCents ||
      !refundReason.trim()
    ) {
      setMessage('Selecciona un pago, indica un importe disponible y escribe el motivo.');
      return;
    }
    const request = JSON.stringify({
      paymentId: payment.id,
      orderItemId: refundOrderItemId,
      amountCents,
      reason: refundReason.trim(),
    });
    if (refundKey.current && refundKey.current.request !== request) {
      setMessage('Reintenta primero la devolución pendiente con los mismos datos.');
      return;
    }
    if (!refundKey.current) refundKey.current = { request, key: createIdempotencyKey() };
    setMessage(undefined);
    try {
      await api.refundOrderPayment(orderId, {
        idempotencyKey: refundKey.current.key,
        paymentId: payment.id,
        ...(refundOrderItemId ? { orderItemId: refundOrderItemId } : {}),
        amountCents,
        reason: refundReason.trim(),
      });
      refundKey.current = undefined;
      setRefundAmount('');
      setRefundReason('');
      setMessage('Devolución registrada. La caja y el saldo fueron actualizados.');
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    } catch (cause) {
      if (cause instanceof BjApiError && !cause.ambiguous) refundKey.current = undefined;
      setMessage(
        cause instanceof BjApiError
          ? cause.message
          : 'No se pudo registrar la devolución. Reintenta la misma solicitud.',
      );
    }
  };
  if (isLoading || capabilitiesQuery.isLoading) return <Loading label="Cargando comanda…" />;
  if (!order)
    return (
      <ScrollScreen>
        <Notice kind="error">
          {error instanceof BjApiError ? error.message : 'No se encontró la comanda.'}
        </Notice>
        <Button label="Reintentar" onPress={() => void refetch()} />
      </ScrollScreen>
    );
  const content = (
    <>
      <SectionTitle
        title={order.customerName || 'Comanda'}
        action={<StatusPill status={order.status} />}
      />
      <Text style={styles.total}>{money(order.totalCents)}</Text>
      {order.manualDiscountCents > 0 ? (
        <Text style={shared.subtitle}>
          Descuento {money(order.manualDiscountCents)} · {order.manualDiscountReason}
        </Text>
      ) : null}
      <Text style={shared.subtitle}>
        {order.neighborhood}
        {order.streetAndNumber ? ` · ${order.streetAndNumber}` : ''}
        {order.references ? `\nReferencias: ${order.references}` : ''}
        {order.deliveryNotes ? `\nIndicaciones: ${order.deliveryNotes}` : ''}
      </Text>
      <Card>
        <Text style={shared.label}>Cobro</Text>
        <Text style={shared.text}>
          Cobrado {money(order.paidCents)} · saldo {money(order.balanceCents)}
        </Text>
        {paymentsEnabled && order.balanceCents > 0 ? (
          <>
            <View style={styles.paymentRow}>
              {(['cash', 'card', 'transfer'] as const).map((method) => (
                <Pill
                  key={method}
                  label={{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[method]}
                  selected={paymentMethod === method}
                  onPress={() => {
                    setPaymentMethod(method);
                    if (checkoutSplitMethod === method) setCheckoutSplitMethod('none');
                  }}
                />
              ))}
            </View>
            <Field
              label="Recibido (MXN)"
              keyboardType="decimal-pad"
              value={received}
              onChangeText={setReceived}
            />
            {order.fulfillment === 'counter' && order.status === 'ready' ? (
              <>
                <View style={styles.paymentRow}>
                  <Pill
                    label="Un solo medio"
                    selected={checkoutSplitMethod === 'none'}
                    onPress={() => setCheckoutSplitMethod('none')}
                  />
                  {(['cash', 'card', 'transfer'] as const)
                    .filter((method) => method !== paymentMethod)
                    .map((method) => (
                      <Pill
                        key={method}
                        label={`+ ${{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[method]}`}
                        selected={checkoutSplitMethod === method}
                        onPress={() => setCheckoutSplitMethod(method)}
                      />
                    ))}
                </View>
                {checkoutSplitMethod !== 'none' ? (
                  <Field
                    label={`Aplicar en ${{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[checkoutSplitMethod]} (MXN)`}
                    keyboardType="decimal-pad"
                    value={checkoutSplitAmount}
                    onChangeText={setCheckoutSplitAmount}
                  />
                ) : null}
                <Button
                  label="Cobrar y entregar"
                  secondary
                  onPress={() => void checkoutCounter()}
                />
              </>
            ) : (
              <Button label="Registrar cobro" secondary onPress={() => void collectPayment()} />
            )}
          </>
        ) : paymentsEnabled ? (
          <Text style={shared.subtitle}>Pago completo confirmado.</Text>
        ) : (
          <Notice kind="warning">
            Los cobros y devoluciones están deshabilitados en el servidor.
          </Notice>
        )}
      </Card>
      {paymentsEnabled && order.payments.some((payment) => payment.refundableCents > 0) ? (
        <Card>
          <Text style={shared.label}>Devoluciones</Text>
          <View style={styles.paymentRow}>
            <Pill
              label="Importe general"
              selected={!refundOrderItemId}
              onPress={() => setRefundOrderItemId('')}
            />
            {order.items.map((item) => (
              <Pill
                key={item.id}
                label={`${item.quantity}× ${item.productName}`}
                selected={refundOrderItemId === item.id}
                onPress={() => setRefundOrderItemId(item.id)}
              />
            ))}
          </View>
          <View style={styles.paymentRow}>
            {order.payments
              .filter((payment) => payment.refundableCents > 0)
              .map((payment) => (
                <Pill
                  key={payment.id}
                  label={`${{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[payment.method]} · ${money(payment.refundableCents)} disponibles`}
                  selected={refundPaymentId === payment.id}
                  onPress={() => setRefundPaymentId(payment.id)}
                />
              ))}
          </View>
          <Field
            label="Importe a devolver (MXN)"
            keyboardType="decimal-pad"
            value={refundAmount}
            onChangeText={setRefundAmount}
          />
          <Field label="Motivo" value={refundReason} onChangeText={setRefundReason} />
          <Button label="Registrar devolución" secondary onPress={() => void refundPayment()} />
        </Card>
      ) : null}
      <Card>
        {order.items.map((item) => (
          <View key={item.id} style={styles.item}>
            <Text style={shared.text}>
              {item.quantity}× {item.productName} · {money(item.lineTotalCents)}
            </Text>
            <Text style={shared.subtitle}>
              {item.removedIngredients.length ? `Sin: ${item.removedIngredients.join(', ')}\n` : ''}
              {item.modifiers.length
                ? `Extras: ${item.modifiers.map((modifier) => modifier.name).join(', ')}\n`
                : ''}
              {item.combo ? `Combo · ${item.combo.drinkName}\n` : ''}
              {item.note}
            </Text>
          </View>
        ))}
      </Card>
      {message ? (
        <Notice kind={message.startsWith('Código') ? 'info' : 'error'}>{message}</Notice>
      ) : null}
      {unifiedOrdersEnabled &&
      (order.fulfillment === 'counter' && order.status === 'ready'
        ? order.balanceCents === 0
          ? 'delivered'
          : undefined
        : nextStatus[order.status]) ? (
        <Button
          label={
            change.isPending
              ? 'Actualizando…'
              : `Marcar como ${statusLabel(order.fulfillment === 'counter' && order.status === 'ready' ? 'delivered' : nextStatus[order.status]!)}`
          }
          disabled={change.isPending}
          onPress={() => {
            setMessage(undefined);
            change.mutate(
              order.fulfillment === 'counter' && order.status === 'ready'
                ? 'delivered'
                : nextStatus[order.status]!,
            );
          }}
        />
      ) : null}
      {unifiedOrdersEnabled && ['new', 'preparing', 'ready'].includes(order.status) ? (
        <Button
          label={change.isPending ? 'Actualizando…' : 'Cancelar comanda'}
          secondary
          disabled={change.isPending}
          onPress={() => {
            setMessage(undefined);
            change.mutate('cancelled');
          }}
        />
      ) : null}
      {order.status === 'delivered' ? (
        <>
          {ticketsEnabled && (
            <Button
              label="Generar y compartir ticket PDF"
              secondary
              onPress={() => void shareTicket()}
            />
          )}
          <Button
            label={order.spinCodeIssued ? 'Recuperar código de ruleta' : 'Emitir código de ruleta'}
            secondary
            onPress={() => void issueSpin()}
          />
          {message?.startsWith('Código') ? (
            <Button
              label="Copiar y compartir código"
              secondary
              onPress={() => void copyOrShare()}
            />
          ) : null}
        </>
      ) : null}
      <Card>
        <Text style={shared.text}>Historial</Text>
        {order.events.map((event) => (
          <View key={event.id} style={styles.event}>
            <Text style={shared.subtitle}>
              {event.status ? statusLabel(event.status) : event.type} ·{' '}
              {new Date(event.createdAt).toLocaleString('es-MX')}
              {event.note ? `\n${event.note}` : ''}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
  return embedded ? (
    <ScrollView contentContainerStyle={shared.content}>{content}</ScrollView>
  ) : (
    <ScrollScreen>{content}</ScrollScreen>
  );
}

type DraftItem = OrderDraft['items'][number];
const emptyDraft = (): OrderDraft => ({
  rawMessage: '',
  customerName: '',
  neighborhood: '',
  streetAndNumber: '',
  references: '',
  deliveryNotes: '',
  items: [],
  unresolvedLines: [],
});
function DraftItemEditor({
  item,
  catalog,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  catalog: Catalog;
  onChange(next: DraftItem): void;
  onRemove(): void;
}) {
  const product = catalog.products.find((candidate) => candidate.id === item.productId);
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((itemValue) => itemValue !== value) : [...list, value];
  return (
    <Card>
      <Text style={shared.text}>{item.productName}</Text>
      <View style={styles.row}>
        <Button
          label="−"
          secondary
          onPress={() => onChange({ ...item, quantity: Math.max(1, item.quantity - 1) })}
        />
        <Text style={shared.text}>{item.quantity}</Text>
        <Button
          label="+"
          secondary
          onPress={() => onChange({ ...item, quantity: item.quantity + 1 })}
        />
        <Button label="Quitar" secondary onPress={onRemove} />
      </View>
      {product?.removableIngredients.length ? (
        <>
          <Text style={shared.label}>Quitar ingredientes</Text>
          <View style={styles.row}>
            {product.removableIngredients.map((ingredient) => (
              <Pill
                key={ingredient}
                label={ingredient}
                selected={item.removedIngredients.includes(ingredient)}
                onPress={() =>
                  onChange({
                    ...item,
                    removedIngredients: toggle(item.removedIngredients, ingredient),
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}
      <Text style={shared.label}>Extras</Text>
      <View style={styles.row}>
        {catalog.modifiers
          .filter((modifier) => modifier.available)
          .map((modifier) => (
            <Pill
              key={modifier.id}
              label={`${modifier.name} ${money(modifier.priceCents)}`}
              selected={item.modifierIds.includes(modifier.id)}
              onPress={() =>
                onChange({ ...item, modifierIds: toggle(item.modifierIds, modifier.id) })
              }
            />
          ))}
      </View>
      {product?.comboEligible ? (
        <Pill
          label="Convertir en combo"
          selected={item.combo}
          onPress={() => {
            if (item.combo) {
              const withoutDrink = { ...item };
              delete withoutDrink.drinkProductId;
              onChange({ ...withoutDrink, combo: false });
            } else onChange({ ...item, combo: true });
          }}
        />
      ) : null}
      {item.combo ? (
        <>
          <Text style={shared.label}>Bebida del combo</Text>
          <View style={styles.row}>
            {catalog.products
              .filter((candidate) => candidate.available && candidate.categoryId === 'drinks')
              .map((drink) => (
                <Pill
                  key={drink.id}
                  label={drink.name}
                  selected={item.drinkProductId === drink.id}
                  onPress={() => onChange({ ...item, drinkProductId: drink.id })}
                />
              ))}
          </View>
        </>
      ) : null}
      <Field label="Nota" value={item.note} onChangeText={(note) => onChange({ ...item, note })} />
    </Card>
  );
}

export function OrderImport() {
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api.catalog() });
  const capabilities = useQuery({
    queryKey: ['pos-capabilities'],
    queryFn: () => api.capabilities(),
  });
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [quotedTotal, setQuotedTotal] = useState<number | undefined>();
  const pending = useRef<UnifiedOrderConfirm | undefined>(undefined);
  useEffect(() => {
    pending.current = undefined;
    setQuotedTotal(undefined);
  }, [draft]);
  const parse = async () => {
    setError(undefined);
    try {
      setDraft(await api.parseOrderDraft(draft.rawMessage));
    } catch (cause) {
      setError(cause instanceof BjApiError ? cause.message : 'No se pudo interpretar el mensaje.');
    }
  };
  const addProduct = (product: Catalog['products'][number]) =>
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          removedIngredients: [],
          modifierIds: [],
          combo: false,
          note: '',
        },
      ],
    }));
  const updateItem = (index: number, next: DraftItem) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? next : item)),
    }));
  const create = async () => {
    const unifiedOrdersEnabled =
      capabilities.data?.some(
        (capability) => capability.key === 'unified_orders' && capability.enabled,
      ) === true;
    if (!unifiedOrdersEnabled) {
      setError(
        'El servidor conectado todavía no habilita el POS unificado. Actualiza la API para confirmar comandas.',
      );
      return;
    }
    if (!draft.items.length) {
      setError('Agrega por lo menos un producto.');
      return;
    }
    if (draft.items.some((item) => item.combo && !item.drinkProductId)) {
      setError('Selecciona una bebida para cada combo.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (!pending.current) {
        const request = {
          fulfillment: 'counter' as const,
          customerName: '',
          neighborhood: '',
          streetAndNumber: '',
          manualDiscountCents: 0,
          manualDiscountReason: '',
          source: 'manual_whatsapp' as const,
          rawMessage: draft.rawMessage,
          items: draft.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            removedIngredients: item.removedIngredients,
            modifierIds: item.modifierIds,
            combo: item.combo,
            ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
            note: item.note,
          })),
        };
        const quote = await api.quoteUnifiedOrder(request);
        setQuotedTotal(quote.totalCents);
        pending.current = {
          ...request,
          quotedTotalCents: quote.totalCents,
          idempotencyKey: createIdempotencyKey(),
        };
        setError(undefined);
        return;
      }
      const order = await api.confirmUnifiedOrder(pending.current);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      router.replace({ pathname: '/(app)/orders/[id]', params: { id: order.id } });
    } catch (cause) {
      if (cause instanceof BjApiError && !cause.ambiguous) pending.current = undefined;
      setError(
        cause instanceof BjApiError
          ? cause.message
          : 'No se pudo confirmar. Reintenta esta misma comanda para evitar duplicarla.',
      );
    } finally {
      setBusy(false);
    }
  };
  if (catalog.isLoading) return <Loading label="Cargando catálogo…" />;
  if (!catalog.data)
    return (
      <ScrollScreen>
        <Notice kind="error">No se pudo cargar el catálogo.</Notice>
      </ScrollScreen>
    );
  return (
    <ScrollScreen>
      <SectionTitle title="Importar de WhatsApp" />
      <Text style={shared.subtitle}>
        Pega el mensaje que llegó por WhatsApp, revisa el resultado y confirma la comanda.
      </Text>
      <Field
        label="Mensaje de WhatsApp"
        value={draft.rawMessage}
        onChangeText={(rawMessage) => {
          pending.current = undefined;
          setDraft((current) => ({ ...current, rawMessage }));
        }}
        multiline
      />
      <Button
        label="Interpretar mensaje"
        secondary
        disabled={busy || draft.rawMessage.trim().length < 3}
        onPress={() => void parse()}
      />
      {draft.unresolvedLines.length ? (
        <Notice kind="warning">No se reconocieron: {draft.unresolvedLines.join(' · ')}</Notice>
      ) : null}
      <Notice>
        La comanda importada se registra para mostrador. No requiere datos de cliente ni domicilio.
      </Notice>
      <Text style={shared.label}>Agregar producto</Text>
      <ScrollView horizontal contentContainerStyle={styles.row}>
        {catalog.data.products
          .filter((product) => product.available)
          .map((product) => (
            <Pill
              key={product.id}
              label={`${product.name} ${money(product.priceCents)}`}
              selected={false}
              onPress={() => addProduct(product)}
            />
          ))}
      </ScrollView>
      {draft.items.map((item, index) => (
        <DraftItemEditor
          key={`${item.productId}-${index}`}
          item={item}
          catalog={catalog.data}
          onChange={(next) => updateItem(index, next)}
          onRemove={() =>
            setDraft((current) => ({
              ...current,
              items: current.items.filter((_, itemIndex) => itemIndex !== index),
            }))
          }
        />
      ))}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {quotedTotal !== undefined ? (
        <>
          <Text style={styles.total}>Total cotizado: {money(quotedTotal)}</Text>
          <Notice kind="warning">Revisa el total y confirma la comanda.</Notice>
        </>
      ) : null}
      {pending.current && !busy ? (
        <Notice kind="warning">La respuesta no se confirmó. Reintenta esta misma comanda.</Notice>
      ) : null}
      <Button
        label={busy ? 'Procesando…' : pending.current ? 'Confirmar comanda' : 'Cotizar comanda'}
        disabled={busy || draft.items.length === 0}
        onPress={() => void create()}
      />
    </ScrollScreen>
  );
}

/** POS de mostrador: arma una comanda directamente desde el catálogo. */
export function OrderBuilder() {
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api.catalog() });
  const capabilities = useQuery({
    queryKey: ['pos-capabilities'],
    queryFn: () => api.capabilities(),
  });
  const queryClient = useQueryClient();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [quote, setQuote] = useState<number | undefined>();
  const [message, setMessage] = useState<string>();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [busy, setBusy] = useState(false);
  const pending = useRef<UnifiedOrderConfirm | undefined>(undefined);
  const enabled =
    capabilities.data?.some(
      (capability) => capability.key === 'unified_orders' && capability.enabled,
    ) === true;

  const updateItem = (index: number, next: DraftItem) => {
    pending.current = undefined;
    setQuote(undefined);
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
  };
  const addProduct = (product: Catalog['products'][number]) => {
    pending.current = undefined;
    setQuote(undefined);
    setItems((current) => [
      ...current,
      {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        removedIngredients: [],
        modifierIds: [],
        combo: false,
        note: '',
      },
    ]);
  };
  const request = (): Omit<UnifiedOrderConfirm, 'quotedTotalCents' | 'idempotencyKey'> => ({
    fulfillment: 'counter',
    customerName: '',
    neighborhood: '',
    streetAndNumber: '',
    manualDiscountCents: 0,
    manualDiscountReason: '',
    source: 'pos',
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      removedIngredients: item.removedIngredients,
      modifierIds: item.modifierIds,
      combo: item.combo,
      ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
      note: item.note,
    })),
  });
  const submit = async () => {
    if (!enabled) {
      setMessage(
        'El servidor conectado todavía no habilita el POS. Actualiza la API para crear comandas.',
      );
      return;
    }
    if (!items.length) {
      setMessage('Agrega al menos un producto.');
      return;
    }
    if (items.some((item) => item.combo && !item.drinkProductId)) {
      setMessage('Selecciona una bebida para cada combo.');
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      if (!pending.current) {
        const currentRequest = request();
        const serverQuote = await api.quoteUnifiedOrder(currentRequest);
        setQuote(serverQuote.totalCents);
        pending.current = {
          ...currentRequest,
          quotedTotalCents: serverQuote.totalCents,
          idempotencyKey: createIdempotencyKey(),
        };
        return;
      }
      const order = await api.confirmUnifiedOrder(pending.current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['business'] }),
      ]);
      router.replace({ pathname: '/(app)/orders/[id]', params: { id: order.id } });
    } catch (cause) {
      if (cause instanceof BjApiError && !cause.ambiguous) pending.current = undefined;
      setMessage(
        cause instanceof BjApiError
          ? cause.message
          : 'No se pudo confirmar. Reintenta esta misma comanda para evitar duplicarla.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (catalog.isLoading || capabilities.isLoading) return <Loading label="Cargando POS…" />;
  if (!catalog.data)
    return (
      <ScrollScreen>
        <SectionTitle title="POS" />
        <Notice kind="error">
          {catalog.error instanceof BjApiError
            ? catalog.error.message
            : 'No se pudo cargar el catálogo. Comprueba la conexión con la API.'}
        </Notice>
        <Button label="Reintentar" onPress={() => void catalog.refetch()} />
      </ScrollScreen>
    );

  return (
    <ScrollScreen>
      <SectionTitle title="Nueva venta" />
      <Text style={shared.subtitle}>
        Agrega productos al carrito, personaliza cada uno y confirma la venta. El servidor valida el
        precio y el inventario.
      </Text>
      {capabilities.error ? (
        <Notice kind="warning">
          La API conectada no publica las capacidades del POS. Puedes preparar el pedido, pero el
          servidor debe actualizarse para cotizarlo y confirmarlo.
        </Notice>
      ) : !enabled ? (
        <Notice kind="warning">El POS aún no está habilitado en este servidor.</Notice>
      ) : null}
      <Field label="Buscar producto" value={search} onChangeText={setSearch} />
      <View style={styles.row}>
        <Pill label="Todo" selected={categoryId === 'all'} onPress={() => setCategoryId('all')} />
        {catalog.data.categories.map((category) => (
          <Pill
            key={category.id}
            label={category.name}
            selected={categoryId === category.id}
            onPress={() => setCategoryId(category.id)}
          />
        ))}
      </View>
      <Text style={shared.label}>Productos · {items.length} en el carrito</Text>
      <View style={styles.productGrid}>
        {catalog.data.products
          .filter(
            (product) =>
              product.available &&
              (categoryId === 'all' || product.categoryId === categoryId) &&
              product.name
                .toLocaleLowerCase('es-MX')
                .includes(search.trim().toLocaleLowerCase('es-MX')),
          )
          .map((product) => (
            <Card key={product.id} style={styles.productCard}>
              <Text style={shared.text}>{product.name}</Text>
              <Text style={shared.subtitle}>{money(product.priceCents)}</Text>
              <Button label="Agregar" onPress={() => addProduct(product)} />
            </Card>
          ))}
      </View>
      {items.map((item, index) => (
        <DraftItemEditor
          key={`${item.productId}-${index}`}
          item={item}
          catalog={catalog.data!}
          onChange={(next) => updateItem(index, next)}
          onRemove={() => {
            pending.current = undefined;
            setQuote(undefined);
            setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
          }}
        />
      ))}
      {quote !== undefined ? (
        <>
          <Text style={styles.total}>Total cotizado: {money(quote)}</Text>
          <Notice kind="warning">Revisa el total y confirma la comanda.</Notice>
        </>
      ) : null}
      {message ? <Notice kind={enabled ? 'error' : 'warning'}>{message}</Notice> : null}
      {pending.current && !busy ? (
        <Notice kind="warning">
          La comanda está lista para confirmar. Si hubo un error de conexión, reintenta la misma
          solicitud.
        </Notice>
      ) : null}
      {items.length ? (
        <Button
          label="Vaciar carrito"
          secondary
          disabled={busy}
          onPress={() => {
            pending.current = undefined;
            setQuote(undefined);
            setItems([]);
            setMessage(undefined);
          }}
        />
      ) : null}
      <Button
        label={busy ? 'Procesando…' : pending.current ? 'Confirmar comanda' : 'Cotizar comanda'}
        disabled={busy || !enabled || items.length === 0}
        onPress={() => void submit()}
      />
      <Button
        label="Importar pedido de WhatsApp"
        secondary
        onPress={() => router.push('/(app)/orders/import')}
      />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 8 },
  orderLayout: { flex: 1, flexDirection: 'row' },
  orderListPane: { width: 410, borderRightWidth: 1, borderRightColor: colors.border },
  detailPane: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 100 },
  orderCard: { gap: 8 },
  selected: { borderColor: colors.gold, borderWidth: 2 },
  status: {
    alignSelf: 'flex-start',
    backgroundColor: '#1c3a25',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  cancelled: { backgroundColor: '#482026' },
  delivered: { backgroundColor: '#214153' },
  statusText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  floating: { position: 'absolute', right: 16, bottom: 16, minWidth: 180 },
  total: { color: colors.gold, fontSize: 30, fontWeight: '800' },
  item: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  event: { paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  productCard: { flexGrow: 1, flexBasis: 175, gap: 8 },
});

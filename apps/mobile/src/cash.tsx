import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { BjApiError, createIdempotencyKey } from '@bj/api-client';
import { api } from './api';
import { centsFromInput, isMoneyInput, money } from './format';
import { Button, Card, Field, Loading, Notice, Pill, ScrollScreen, SectionTitle } from './ui';
import { shared } from './theme';

type CloseReport = {
  id: string;
  status: 'closed';
  openingFundCents: number;
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
  openedAt: string;
  closedAt: string;
};

export function CashPage() {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ['cash-session'], queryFn: () => api.cashSession() });
  const capabilities = useQuery({
    queryKey: ['pos-capabilities'],
    queryFn: () => api.capabilities(),
  });
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'income' | 'expense' | 'withdrawal'>('income');
  const [counted, setCounted] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'info' | 'error'>('error');
  const [closingNote, setClosingNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closeReceipt, setCloseReceipt] = useState<CloseReport | null>(null);
  const [expenseCategory, setExpenseCategory] = useState<
    'rent' | 'utilities' | 'supplies' | 'maintenance' | 'commission' | 'other'
  >('other');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseMethod, setExpenseMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [expenseOrigin, setExpenseOrigin] = useState<'cash_session' | 'external'>('cash_session');
  const [expensePaymentId, setExpensePaymentId] = useState('');
  const actionKey = useRef<{ request: string; key: string } | undefined>(undefined);
  const refresh = () => client.invalidateQueries({ queryKey: ['cash-session'] });
  const run = async (fingerprint: string, fn: (idempotencyKey: string) => Promise<unknown>) => {
    if (busy) return;
    if (actionKey.current && actionKey.current.request !== fingerprint) {
      setMessageKind('error');
      setMessage(
        'Hay una operación con resultado incierto. Reintenta primero con los mismos datos.',
      );
      return;
    }
    if (!actionKey.current)
      actionKey.current = { request: fingerprint, key: createIdempotencyKey() };
    try {
      setBusy(true);
      setMessage('');
      await fn(actionKey.current.key);
      actionKey.current = undefined;
      await refresh();
    } catch (e) {
      if (e instanceof BjApiError && !e.ambiguous) actionKey.current = undefined;
      setMessageKind('error');
      setMessage(e instanceof BjApiError ? e.message : 'No fue posible confirmar la operación.');
    } finally {
      setBusy(false);
    }
  };
  const saveExpense = async () => {
    const amountCents = centsFromInput(expenseAmount);
    if (!isMoneyInput(expenseAmount) || amountCents <= 0 || expenseDescription.trim().length < 3) {
      setMessageKind('error');
      setMessage('Escribe una descripción y un importe válidos.');
      return;
    }
    const request = JSON.stringify({
      expenseCategory,
      expenseDescription,
      amountCents,
      expenseMethod,
      expenseOrigin,
      expensePaymentId,
    });
    await run(request, async (idempotencyKey) => {
      const result = await api.createExpense({
        idempotencyKey,
        category: expenseCategory,
        description: expenseDescription.trim(),
        amountCents,
        paymentMethod: expenseMethod,
        fundsOrigin: expenseOrigin,
        occurredAt: new Date().toISOString(),
        ...(expenseCategory === 'commission' ? { paymentId: expensePaymentId.trim() } : {}),
      });
      setExpenseDescription('');
      setExpenseAmount('');
      setExpensePaymentId('');
      setMessageKind('info');
      setMessage(`Gasto confirmado${result.reused ? ' (recuperado)' : ''}.`);
      await client.invalidateQueries({ queryKey: ['reports'] });
    });
  };
  if (q.isLoading || capabilities.isLoading) return <Loading label="Cargando caja…" />;
  if (q.isError || capabilities.isError) {
    const queryError = q.error ?? capabilities.error;
    return (
      <ScrollScreen>
        <SectionTitle
          title="Caja"
          action={
            <Button
              label="Reintentar"
              secondary
              disabled={q.isFetching || capabilities.isFetching}
              onPress={() => void Promise.all([q.refetch(), capabilities.refetch()])}
            />
          }
        />
        <Notice kind="error">
          {queryError instanceof BjApiError
            ? queryError.message
            : 'No se pudo consultar la caja. No inicies un turno hasta confirmar el estado del servidor.'}
        </Notice>
      </ScrollScreen>
    );
  }
  const session = q.data?.session;
  const cashEnabled =
    capabilities.data?.some(
      (capability) => capability.key === 'cash_sessions' && capability.enabled,
    ) === true;
  const expensesEnabled =
    capabilities.data?.some((capability) => capability.key === 'expenses' && capability.enabled) ===
    true;
  const openingFundCents = centsFromInput(amount);
  const movementAmountCents = centsFromInput(amount);
  const countedCents = centsFromInput(counted);
  const validCount =
    isMoneyInput(counted) && Number.isSafeInteger(countedCents) && countedCents >= 0;
  const differenceCents = session ? countedCents - session.expectedCents : 0;
  const lastClosedSession = q.data?.lastClosedSession ?? closeReceipt;
  const recentClosings = q.data?.recentClosings?.length
    ? q.data.recentClosings
    : closeReceipt
      ? [closeReceipt]
      : [];
  return (
    <ScrollScreen>
      <SectionTitle
        title="Caja"
        action={<Button label="Actualizar" secondary onPress={() => void q.refetch()} />}
      />
      {message ? <Notice kind={messageKind}>{message}</Notice> : null}
      {!cashEnabled ? (
        <Notice kind="warning">
          La caja está deshabilitada hasta activar esta capacidad en el servidor.
        </Notice>
      ) : !session ? (
        <>
          <Notice kind="warning">
            Abre un turno antes de recibir efectivo o registrar salidas.
          </Notice>
          <Field
            label="Fondo inicial (MXN)"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <Button
            label="Abrir caja"
            disabled={busy || !isMoneyInput(amount) || openingFundCents < 0}
            onPress={() =>
              void run(
                JSON.stringify({ action: 'open', openingFundCents }),
                async (idempotencyKey) => {
                  await api.openCashSession({ idempotencyKey, openingFundCents });
                  setAmount('');
                },
              )
            }
          />
        </>
      ) : (
        <>
          <Card>
            <Text style={shared.label}>Efectivo esperado</Text>
            <Text style={shared.title}>{money(session.expectedCents)}</Text>
            <Text style={shared.subtitle}>Fondo inicial {money(session.openingFundCents)}</Text>
            <Text style={shared.subtitle}>
              Abierta {new Date(session.openedAt).toLocaleString('es-MX')}
            </Text>
          </Card>
          <Text style={shared.label}>Movimiento manual</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['income', 'Entrada'],
                ['expense', 'Salida'],
                ['withdrawal', 'Retiro'],
              ] as const
            ).map(([v, l]) => (
              <Pill key={v} label={l} selected={kind === v} onPress={() => setKind(v)} />
            ))}
          </View>
          <Field
            label="Importe (MXN)"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <Field label="Motivo" value={reason} onChangeText={setReason} />
          <Button
            label="Registrar movimiento"
            secondary
            disabled={
              busy || !isMoneyInput(amount) || movementAmountCents <= 0 || reason.trim().length < 3
            }
            onPress={() => {
              const input = { kind, amountCents: movementAmountCents, reason: reason.trim() };
              void run(JSON.stringify({ action: 'movement', ...input }), async (idempotencyKey) => {
                await api.recordCashMovement({ idempotencyKey, ...input });
                setAmount('');
                setReason('');
              });
            }}
          />
          <Card>
            <Text style={shared.label}>Movimientos de este turno</Text>
            {q.data?.movements.length ? (
              q.data.movements.map((m) => (
                <Text key={m.id} style={shared.subtitle}>
                  {(
                    {
                      income: 'Entrada',
                      expense: 'Salida',
                      withdrawal: 'Retiro',
                      adjustment: 'Ajuste',
                    } as Record<string, string>
                  )[m.kind] ?? m.kind}
                  {' · '}
                  {money(Math.abs(m.amountCents))} · {m.reason}
                </Text>
              ))
            ) : (
              <Text style={shared.subtitle}>Todavía no hay movimientos manuales.</Text>
            )}
          </Card>
          <Field
            label="Efectivo contado al cierre (MXN)"
            keyboardType="decimal-pad"
            value={counted}
            onChangeText={setCounted}
          />
          {validCount ? (
            <Card>
              <Text style={shared.label}>Diferencia estimada al corte</Text>
              <Text style={shared.title}>{money(differenceCents)}</Text>
              <Text style={shared.subtitle}>
                {differenceCents === 0
                  ? 'El efectivo contado cuadra con lo esperado.'
                  : differenceCents > 0
                    ? 'Sobrante respecto al efectivo esperado.'
                    : 'Faltante respecto al efectivo esperado.'}
              </Text>
            </Card>
          ) : (
            <Notice compact>Cuenta el efectivo físico para habilitar el cierre.</Notice>
          )}
          <Field
            label="Nota del corte (opcional)"
            value={closingNote}
            onChangeText={setClosingNote}
          />
          <Button
            label={busy ? 'Cerrando…' : 'Cerrar y ver corte'}
            disabled={busy || !validCount}
            onPress={() => {
              const input = { countedCents, note: closingNote.trim() };
              void run(JSON.stringify({ action: 'close', ...input }), async (idempotencyKey) => {
                const report = await api.closeCashSession({ idempotencyKey, ...input });
                setCloseReceipt({
                  id: report.id,
                  status: 'closed',
                  openingFundCents: session.openingFundCents,
                  expectedCents: report.expectedCents,
                  countedCents: report.countedCents,
                  differenceCents: report.differenceCents,
                  openedAt: session.openedAt,
                  closedAt: new Date().toISOString(),
                });
                setCounted('');
                setClosingNote('');
              });
            }}
          />
        </>
      )}
      {lastClosedSession ? (
        <Card>
          <Text style={shared.label}>Último corte de caja</Text>
          <Text style={shared.subtitle}>
            {lastClosedSession.closedAt
              ? new Date(lastClosedSession.closedAt).toLocaleString('es-MX')
              : 'Cierre registrado'}
          </Text>
          <Text style={shared.text}>
            Fondo inicial · {money(lastClosedSession.openingFundCents)}
          </Text>
          <Text style={shared.text}>
            Efectivo esperado · {money(lastClosedSession.expectedCents)}
          </Text>
          <Text style={shared.text}>
            Efectivo contado · {money(lastClosedSession.countedCents)}
          </Text>
          <Text style={shared.title}>Diferencia · {money(lastClosedSession.differenceCents)}</Text>
        </Card>
      ) : null}
      {recentClosings.length > 1 ? (
        <Card>
          <Text style={shared.label}>Otros cortes recientes</Text>
          {recentClosings
            .filter((closing) => closing.id !== lastClosedSession?.id)
            .map((closing) => (
              <View key={closing.id} style={{ gap: 3, paddingTop: 8 }}>
                <Text style={shared.text}>
                  {closing.closedAt
                    ? new Date(closing.closedAt).toLocaleString('es-MX')
                    : 'Cierre registrado'}
                </Text>
                <Text style={shared.subtitle}>
                  Fondo {money(closing.openingFundCents)} · esperado {money(closing.expectedCents)}
                  {' · '}contado {money(closing.countedCents)} · diferencia{' '}
                  {money(closing.differenceCents)}
                </Text>
              </View>
            ))}
        </Card>
      ) : null}
      {expensesEnabled ? (
        <Card>
          <Text style={shared.label}>Registrar gasto operativo</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['rent', 'Renta'],
                ['utilities', 'Servicios'],
                ['supplies', 'Insumos'],
                ['maintenance', 'Mantenimiento'],
                ['commission', 'Comisión'],
                ['other', 'Otro'],
              ] as const
            ).map(([value, label]) => (
              <Pill
                key={value}
                label={label}
                selected={expenseCategory === value}
                onPress={() => setExpenseCategory(value)}
              />
            ))}
          </View>
          <Field
            label="Descripción"
            value={expenseDescription}
            onChangeText={setExpenseDescription}
          />
          <Field
            label="Importe (MXN)"
            keyboardType="decimal-pad"
            value={expenseAmount}
            onChangeText={setExpenseAmount}
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['cash', 'card', 'transfer'] as const).map((value) => (
              <Pill
                key={value}
                label={{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[value]}
                selected={expenseMethod === value}
                onPress={() => setExpenseMethod(value)}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill
              label="Caja del turno"
              selected={expenseOrigin === 'cash_session'}
              onPress={() => setExpenseOrigin('cash_session')}
            />
            <Pill
              label="Fondos externos"
              selected={expenseOrigin === 'external'}
              onPress={() => setExpenseOrigin('external')}
            />
          </View>
          {expenseCategory === 'commission' ? (
            <Field
              label="ID del pago original"
              value={expensePaymentId}
              onChangeText={setExpensePaymentId}
            />
          ) : null}
          <Button label="Guardar gasto" secondary onPress={() => void saveExpense()} />
        </Card>
      ) : (
        <Notice kind="warning">
          El registro de gastos está deshabilitado hasta activar esta capacidad en el servidor.
        </Notice>
      )}
      <Button
        label="Ver reportes del negocio"
        secondary
        onPress={() => router.push('/(app)/reports')}
      />
    </ScrollScreen>
  );
}

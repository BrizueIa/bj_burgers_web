import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { BjApiError, createIdempotencyKey } from '@bj/api-client';
import { api } from './api';
import { centsFromInput, money } from './format';
import { Button, Card, Field, Loading, Notice, Pill, ScrollScreen, SectionTitle } from './ui';
import { shared } from './theme';
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
    if (actionKey.current && actionKey.current.request !== fingerprint) {
      setMessage(
        'Hay una operación con resultado incierto. Reintenta primero con los mismos datos.',
      );
      return;
    }
    if (!actionKey.current)
      actionKey.current = { request: fingerprint, key: createIdempotencyKey() };
    try {
      setMessage('');
      await fn(actionKey.current.key);
      actionKey.current = undefined;
      await refresh();
    } catch (e) {
      if (e instanceof BjApiError && !e.ambiguous) actionKey.current = undefined;
      setMessage(e instanceof BjApiError ? e.message : 'No fue posible confirmar la operación.');
    }
  };
  const saveExpense = async () => {
    const amountCents = centsFromInput(expenseAmount);
    if (amountCents <= 0 || expenseDescription.trim().length < 3) {
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
      setMessage(`Gasto confirmado${result.reused ? ' (recuperado)' : ''}.`);
      await client.invalidateQueries({ queryKey: ['reports'] });
    });
  };
  if (q.isLoading || capabilities.isLoading) return <Loading label="Cargando caja…" />;
  const session = q.data?.session;
  const cashEnabled =
    capabilities.data?.some(
      (capability) => capability.key === 'cash_sessions' && capability.enabled,
    ) === true;
  const expensesEnabled =
    capabilities.data?.some((capability) => capability.key === 'expenses' && capability.enabled) ===
    true;
  return (
    <ScrollScreen>
      <SectionTitle
        title="Caja"
        action={<Button label="Actualizar" secondary onPress={() => void q.refetch()} />}
      />
      {message ? <Notice kind="error">{message}</Notice> : null}
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
            onPress={() => {
              const openingFundCents = centsFromInput(amount);
              void run(JSON.stringify({ action: 'open', openingFundCents }), (idempotencyKey) =>
                api.openCashSession({ idempotencyKey, openingFundCents }),
              );
            }}
          />
        </>
      ) : (
        <>
          <Card>
            <Text style={shared.label}>Efectivo esperado</Text>
            <Text style={shared.title}>{money(session.expectedCents)}</Text>
            <Text style={shared.subtitle}>Fondo inicial {money(session.openingFundCents)}</Text>
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
            onPress={() => {
              const input = { kind, amountCents: centsFromInput(amount), reason };
              void run(JSON.stringify({ action: 'movement', ...input }), (idempotencyKey) =>
                api.recordCashMovement({ idempotencyKey, ...input }),
              );
            }}
          />
          <Card>
            {q.data?.movements.map((m) => (
              <Text key={m.id} style={shared.subtitle}>
                {m.kind} · {money(m.amountCents)} · {m.reason}
              </Text>
            ))}
          </Card>
          <Field
            label="Efectivo contado al cierre (MXN)"
            keyboardType="decimal-pad"
            value={counted}
            onChangeText={setCounted}
          />
          <Button
            label="Cerrar caja"
            onPress={() => {
              const input = { countedCents: centsFromInput(counted), note: 'Cierre desde Android' };
              void run(JSON.stringify({ action: 'close', ...input }), (idempotencyKey) =>
                api.closeCashSession({ idempotencyKey, ...input }),
              );
            }}
          />
        </>
      )}
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
    </ScrollScreen>
  );
}

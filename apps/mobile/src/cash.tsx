import { useState } from 'react';
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
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'income' | 'expense' | 'withdrawal'>('income');
  const [counted, setCounted] = useState('');
  const [message, setMessage] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['cash-session'] });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setMessage('');
      await fn();
      await refresh();
    } catch (e) {
      setMessage(e instanceof BjApiError ? e.message : 'No fue posible confirmar la operación.');
    }
  };
  if (q.isLoading) return <Loading label="Cargando caja…" />;
  const session = q.data?.session;
  return (
    <ScrollScreen>
      <SectionTitle
        title="Caja"
        action={<Button label="Actualizar" secondary onPress={() => void q.refetch()} />}
      />
      {message ? <Notice kind="error">{message}</Notice> : null}
      {!session ? (
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
            onPress={() =>
              void run(() =>
                api.openCashSession({
                  idempotencyKey: createIdempotencyKey(),
                  openingFundCents: centsFromInput(amount),
                }),
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
            onPress={() =>
              void run(() =>
                api.recordCashMovement({
                  idempotencyKey: createIdempotencyKey(),
                  kind,
                  amountCents: centsFromInput(amount),
                  reason,
                }),
              )
            }
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
            onPress={() =>
              void run(() =>
                api.closeCashSession({
                  idempotencyKey: createIdempotencyKey(),
                  countedCents: centsFromInput(counted),
                  note: 'Cierre desde Android',
                }),
              )
            }
          />
        </>
      )}
    </ScrollScreen>
  );
}

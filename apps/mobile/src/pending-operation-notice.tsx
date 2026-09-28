import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Notice } from './ui';
import { listPendingOperations, resolvePendingOperation } from './api';

export function PendingOperationNotice() {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof listPendingOperations>>>([]);
  const refresh = useCallback(() => {
    void listPendingOperations()
      .then(setPending)
      .catch(() => setPending([]));
  }, []);
  useEffect(() => refresh(), [refresh]);
  if (!pending.length) return null;
  const item = pending[0]!;
  const operation = item.path.split('/').filter(Boolean).slice(-2).join(' · ');
  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 6 }}>
      <Notice kind="warning">
        {item.sameDeviceIdentity
          ? `Hay una operación ${operation} pendiente de confirmar. Repite la solicitud con los mismos datos en su pantalla para recuperar el resultado.`
          : `La operación ${operation} quedó pendiente antes de volver a vincular el dispositivo. Verifica su resultado en comandas o caja antes de liberar este bloqueo.`}
      </Notice>
      {!item.sameDeviceIdentity ? (
        <Button
          label="Ya verifiqué el resultado, liberar bloqueo"
          secondary
          onPress={() => {
            void resolvePendingOperation(item.path, item.idempotencyKey).then(refresh);
          }}
        />
      ) : null}
    </View>
  );
}

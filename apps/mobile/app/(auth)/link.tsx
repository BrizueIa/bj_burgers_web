import { useState } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { BjApiError } from '@bj/api-client';
import { api } from '@/src/api';
import { Button, Card, Field, Notice, ScrollScreen } from '@/src/ui';
import { colors, shared } from '@/src/theme';
import { useSession } from '@/src/session';

export default function LinkDeviceScreen() {
  const [deviceId, setDeviceId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { refresh } = useSession();
  const activate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.activateDevice(deviceId, pairingCode);
      await refresh();
      router.replace('/(app)/home');
    } catch (cause) {
      setError(
        cause instanceof BjApiError ? cause.message : 'No fue posible vincular este dispositivo.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollScreen>
      <Card style={{ marginTop: 60, maxWidth: 520, alignSelf: 'center', width: '100%' }}>
        <Text style={[shared.title, { color: colors.gold }]}>B&J Burgers</Text>
        <Text style={shared.title}>Vincular este Android</Text>
        <Text style={shared.subtitle}>
          Crea un código temporal desde el panel B&J. Por seguridad, una instalación nueva debe
          vincularse otra vez.
        </Text>
        <Field
          label="ID del dispositivo"
          value={deviceId}
          onChangeText={setDeviceId}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label="Código temporal"
          value={pairingCode}
          onChangeText={setPairingCode}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Button
          label={busy ? 'Vinculando…' : 'Vincular dispositivo'}
          disabled={busy || !deviceId.trim() || !pairingCode.trim()}
          onPress={() => void activate()}
        />
      </Card>
    </ScrollScreen>
  );
}

import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import {
  BjApiClient,
  BjApiError,
  type CredentialStore,
  type PendingOperationStore,
} from '@bj/api-client';

const credentialKey = 'bj_operator_credential';
const deviceNameKey = 'bj_operator_device_name';
const pendingOperationsKey = 'bj_pending_api_operations';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
type PendingOperation = {
  path: string;
  fingerprint: string;
  idempotencyKey: string;
  credential: string;
};
const pendingOperations: PendingOperationStore = {
  async prepare(input) {
    const credential = await SecureStore.getItemAsync(credentialKey);
    if (!credential) throw new BjApiError('Este dispositivo aún no está vinculado.', 401);
    const raw = await SecureStore.getItemAsync(pendingOperationsKey);
    const pending: PendingOperation[] = raw ? (JSON.parse(raw) as PendingOperation[]) : [];
    const existing = pending.find((item) => item.path === input.path);
    if (existing) {
      if (existing.fingerprint !== input.fingerprint || existing.credential !== credential)
        throw new BjApiError(
          'Hay una operación pendiente de confirmar. Recupera esa operación antes de enviar otra.',
          409,
          undefined,
          { category: 'conflict', method: 'POST', path: input.path },
        );
      return existing.idempotencyKey;
    }
    pending.push({ ...input, credential });
    await SecureStore.setItemAsync(pendingOperationsKey, JSON.stringify(pending));
    return input.idempotencyKey;
  },
  async complete(path, idempotencyKey) {
    const raw = await SecureStore.getItemAsync(pendingOperationsKey);
    if (!raw) return;
    const pending = JSON.parse(raw) as PendingOperation[];
    const remaining = pending.filter(
      (item) => !(item.path === path && item.idempotencyKey === idempotencyKey),
    );
    if (remaining.length)
      await SecureStore.setItemAsync(pendingOperationsKey, JSON.stringify(remaining));
    else await SecureStore.deleteItemAsync(pendingOperationsKey);
  },
};
export async function listPendingOperations() {
  const raw = await SecureStore.getItemAsync(pendingOperationsKey);
  if (!raw) return [];
  const credential = await SecureStore.getItemAsync(credentialKey);
  return (JSON.parse(raw) as PendingOperation[]).map(
    ({ path, fingerprint, idempotencyKey, credential: owner }) => ({
      path,
      fingerprint,
      idempotencyKey,
      sameDeviceIdentity: owner === credential,
    }),
  );
}
export async function resolvePendingOperation(path: string, idempotencyKey: string) {
  await pendingOperations.complete(path, idempotencyKey);
}
export const credentials: CredentialStore & { subscribe(listener: () => void): () => void } = {
  getCredential: () => SecureStore.getItemAsync(credentialKey),
  async saveCredential(input) {
    await SecureStore.setItemAsync(credentialKey, input.credential);
    await SecureStore.setItemAsync(deviceNameKey, input.deviceName);
    notify();
  },
  async clearCredential() {
    await SecureStore.deleteItemAsync(credentialKey);
    await SecureStore.deleteItemAsync(deviceNameKey);
    notify();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const configuredBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
const fetchWhenOnline: typeof fetch = async (input, init) => {
  const connection = await NetInfo.fetch();
  if (connection.isConnected === false || connection.isInternetReachable === false)
    throw new BjApiError(
      'Sin conexión. Conéctate a internet para comunicarte con el servidor.',
      undefined,
      undefined,
      {
        category: 'network',
        method: init?.method ?? 'GET',
        path: typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url,
      },
    );
  return fetch(input, init);
};
export const api = new BjApiClient({
  baseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL ?? configuredBaseUrl ?? 'http://10.0.2.2:4100/api/v1',
  credentialStore: credentials,
  fetch: fetchWhenOnline,
  pendingOperations,
});

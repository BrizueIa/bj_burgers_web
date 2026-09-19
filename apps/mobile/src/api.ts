import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { BjApiClient, type CredentialStore } from '@bj/api-client';

const credentialKey = 'bj_operator_credential';
const deviceNameKey = 'bj_operator_device_name';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
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
export const api = new BjApiClient({
  baseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL ?? configuredBaseUrl ?? 'http://10.0.2.2:4100/api/v1',
  credentialStore: credentials,
});

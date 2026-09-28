import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/src/session';

export default function RootLayout() {
  useEffect(
    () =>
      onlineManager.setEventListener((setOnline) =>
        NetInfo.addEventListener((state) =>
          setOnline(state.isConnected !== false && state.isInternetReachable !== false),
        ),
      ),
    [],
  );
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            networkMode: 'online',
            retry: (failureCount, error) => {
              const retryable = Boolean(
                error && typeof error === 'object' && 'retryable' in error && error.retryable,
              );
              return retryable && failureCount < 2;
            },
            retryDelay: (attempt, error) => {
              const retryAfterMs =
                error && typeof error === 'object' && 'metadata' in error
                  ? (error as { metadata?: { retryAfterMs?: number } }).metadata?.retryAfterMs
                  : undefined;
              return retryAfterMs ?? Math.min(1_000 * 2 ** attempt, 8_000);
            },
            staleTime: 8_000,
          },
          mutations: { networkMode: 'online', retry: 0 },
        },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="light" />
          <Slot />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

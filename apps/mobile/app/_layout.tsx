import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SessionProvider } from '@/src/session';
import { shared } from '@/src/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 8_000 } } }),
  );
  return (
    <SafeAreaProvider>
      <SafeAreaView style={shared.screen} edges={['top', 'bottom']}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <StatusBar style="light" />
            <Slot />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

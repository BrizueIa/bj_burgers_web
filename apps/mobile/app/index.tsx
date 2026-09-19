import { Redirect } from 'expo-router';
import { Loading, Screen } from '@/src/ui';
import { useSession } from '@/src/session';
export default function Index() {
  const { loading, linked } = useSession();
  if (loading)
    return (
      <Screen>
        <Loading label="Comprobando dispositivo…" />
      </Screen>
    );
  return <Redirect href={linked ? '/(app)/home' : '/(auth)/link'} />;
}

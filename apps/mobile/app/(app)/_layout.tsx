import { Redirect, Slot, router, usePathname } from 'expo-router';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Loading, Screen } from '@/src/ui';
import { colors, shared } from '@/src/theme';
import { useOnline } from '@/src/hooks';
import { useSession } from '@/src/session';

const nav = [
  ['Inicio', '/(app)/home'],
  ['Comandas', '/(app)/orders'],
  ['POS', '/(app)/pos'],
  ['Inventario', '/(app)/inventory'],
  ['Recetas', '/(app)/recipes'],
  ['Caja', '/(app)/cash'],
  ['Reportes', '/(app)/reports'],
] as const;

export default function AppLayout() {
  const { loading, linked } = useSession();
  const { width } = useWindowDimensions();
  const online = useOnline();
  const pathname = usePathname();
  const tablet = width >= 760;
  if (loading)
    return (
      <Screen>
        <Loading label="Comprobando dispositivo…" />
      </Screen>
    );
  if (!linked) return <Redirect href="/(auth)/link" />;
  const menu = (
    <View style={tablet ? styles.sidebar : styles.bottomNav}>
      {tablet ? <Text style={styles.brand}>B&J · Operación</Text> : null}
      {nav.map(([label, href]) => (
        <Button
          key={href}
          secondary={pathname !== href.replace('/(app)', '')}
          label={label}
          onPress={() => router.replace(href)}
        />
      ))}
    </View>
  );
  return (
    <SafeAreaView style={shared.screen} edges={['top', 'bottom']}>
      <View style={styles.offline}>
        {!online ? (
          <Text style={styles.offlineText}>
            Sin conexión. Los cambios no se pueden confirmar hasta reconectar.
          </Text>
        ) : null}
      </View>
      <View style={styles.root}>
        {tablet ? menu : null}
        <View style={styles.main}>
          <Slot />
        </View>
      </View>
      {tablet ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bottomScroll}
        >
          {menu}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  sidebar: {
    width: 190,
    padding: 14,
    gap: 10,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.panel,
  },
  brand: { color: colors.gold, fontWeight: '800', fontSize: 18, marginBottom: 12 },
  bottomNav: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  bottomScroll: { backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.border },
  offline: { backgroundColor: '#5b3d10' },
  offlineText: {
    color: colors.text,
    textAlign: 'center',
    padding: 6,
    fontSize: 12,
    fontWeight: '700',
  },
});

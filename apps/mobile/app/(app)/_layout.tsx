import { Redirect, Slot, router, usePathname } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Button, Loading, Screen } from '@/src/ui';
import { colors, shared } from '@/src/theme';
import { useOnline } from '@/src/hooks';
import { useSession } from '@/src/session';

const nav = [
  { label: 'Inicio', href: '/(app)/home', icon: 'home-variant-outline' },
  { label: 'Comandas', href: '/(app)/orders', icon: 'receipt-text-outline' },
  { label: 'POS', href: '/(app)/pos', icon: 'storefront-outline' },
  { label: 'Inventario', href: '/(app)/inventory', icon: 'package-variant-closed' },
  { label: 'Recetas', href: '/(app)/recipes', icon: 'book-open-page-variant-outline' },
  { label: 'Caja', href: '/(app)/cash', icon: 'cash-register' },
  { label: 'Reportes', href: '/(app)/reports', icon: 'chart-box-outline' },
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
      {nav.map(({ label, href, icon }) => {
        const route = href.replace('/(app)', '');
        const selected = pathname === route || pathname.startsWith(`${route}/`);
        return tablet ? (
          <Button
            key={href}
            secondary={!selected}
            label={label}
            onPress={() => router.replace(href)}
          />
        ) : (
          <Pressable
            key={href}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={`Abrir ${label}`}
            accessibilityState={{ selected }}
            onPress={() => router.replace(href)}
            style={[styles.navItem, selected && styles.navItemSelected]}
          >
            <MaterialCommunityIcons
              name={icon}
              size={23}
              color={selected ? colors.gold : colors.text}
            />
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <View style={shared.screen}>
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
      {tablet ? null : menu}
    </View>
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
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    minHeight: 60,
    paddingHorizontal: 4,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  navItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    height: 52,
    marginHorizontal: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  navItemSelected: { backgroundColor: colors.panelRaised },
  offline: { backgroundColor: '#5b3d10' },
  offlineText: {
    color: colors.text,
    textAlign: 'center',
    padding: 6,
    fontSize: 12,
    fontWeight: '700',
  },
});

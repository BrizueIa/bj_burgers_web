import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { colors, shared } from './theme';
export function Screen({ children }: PropsWithChildren) {
  return <View style={shared.screen}>{children}</View>;
}
export function ScrollScreen({ children }: PropsWithChildren) {
  return (
    <Screen>
      <ScrollView contentContainerStyle={shared.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </Screen>
  );
}
export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[shared.card, style]}>{children}</View>;
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  testID,
}: {
  label: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        shared.button,
        secondary && shared.secondaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[shared.buttonText, secondary && shared.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}
export function Field({
  label,
  error,
  multiline = false,
  ...props
}: TextInputProps & { label: string; error?: string; multiline?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={shared.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[shared.input, multiline && styles.multiline]}
        multiline={multiline}
        {...props}
      />
      {error ? <Text style={shared.error}>{error}</Text> : null}
    </View>
  );
}
export function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, selected && styles.pillSelected]}>
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text>
    </Pressable>
  );
}
export function Notice({
  children,
  kind = 'info',
}: PropsWithChildren<{ kind?: 'info' | 'error' | 'warning' }>) {
  return (
    <View
      style={[
        styles.notice,
        kind === 'error' && styles.errorNotice,
        kind === 'warning' && styles.warningNotice,
      ]}
    >
      <Text style={kind === 'error' ? shared.error : shared.subtitle}>{children}</Text>
    </View>
  );
}
export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.gold} />
      <Text style={shared.subtitle}>{label}</Text>
    </View>
  );
}
export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={shared.title}>{title}</Text>
      {action}
    </View>
  );
}
const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  field: { gap: 6 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.panel,
  },
  pillSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  pillText: { color: colors.text, fontWeight: '700' },
  pillTextSelected: { color: colors.ink },
  notice: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#17221a',
    borderColor: colors.border,
    borderWidth: 1,
  },
  errorNotice: { backgroundColor: '#34171d', borderColor: colors.red },
  warningNotice: { backgroundColor: '#392d13', borderColor: colors.gold },
  loading: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});

import { StyleSheet } from 'react-native';

export const colors = {
  ink: '#0a0d0b',
  panel: '#151a16',
  panelRaised: '#202720',
  border: '#354036',
  text: '#f8f5ee',
  muted: '#b7bdb7',
  gold: '#e8b85f',
  red: '#ef233c',
  green: '#6ecf78',
  blue: '#6ba8ff',
};

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { padding: 16, gap: 12 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 7,
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  text: { color: colors.text, fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    backgroundColor: '#101510',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  button: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  buttonText: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  secondaryButton: {
    backgroundColor: colors.panelRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.text },
  error: { color: '#ff8a97', lineHeight: 20 },
  separator: { height: 1, backgroundColor: colors.border },
});

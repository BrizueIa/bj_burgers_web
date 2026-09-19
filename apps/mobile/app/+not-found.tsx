import { Link } from 'expo-router';
import { Text } from 'react-native';
import { ScrollScreen } from '@/src/ui';
import { shared } from '@/src/theme';
export default function NotFound() {
  return (
    <ScrollScreen>
      <Text style={shared.title}>Pantalla no encontrada</Text>
      <Link href="/" style={shared.text}>
        Volver al inicio
      </Link>
    </ScrollScreen>
  );
}

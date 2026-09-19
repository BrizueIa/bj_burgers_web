import { useLocalSearchParams } from 'expo-router';
import { BusinessEditor, type BusinessMode } from '@/src/business';
export default function BusinessEditorScreen() {
  const { mode, productId } = useLocalSearchParams<{ mode: BusinessMode; productId?: string }>();
  return <BusinessEditor mode={mode} productId={productId} />;
}

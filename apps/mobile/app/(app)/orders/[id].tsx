import { useLocalSearchParams } from 'expo-router';
import { OrderDetailPanel } from '@/src/orders';
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderDetailPanel orderId={id} />;
}

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ProfitabilityReport } from '@bj/contracts';
import { api } from './api';
import { Button, Card, Field, Notice, ScrollScreen, SectionTitle } from './ui';
import { colors, shared } from './theme';
import { money } from './format';

function localDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const labels: Record<string, string> = {
  deliveredOrders: 'Pedidos entregados',
  grossSalesCents: 'Ventas entregadas',
  refundsCents: 'Devoluciones',
  netSalesCents: 'Ventas netas',
  costOfGoodsSoldCents: 'Costo vendido',
  grossProfitCents: 'Utilidad bruta',
  commissionsCents: 'Comisiones',
  operatingExpensesCents: 'Gastos operativos',
  wasteCents: 'Mermas',
  operatingResultCents: 'Resultado operativo',
  cashCollectedCents: 'Efectivo cobrado',
  cashRefundedCents: 'Efectivo devuelto',
  cashFlowInCents: 'Entradas de caja',
  cashFlowOutCents: 'Salidas de caja',
  pendingCostCents: 'Costo pendiente de clasificar',
  unvaluedDeliveredOrders: 'Pedidos sin costo histórico',
};
const styles = StyleSheet.create({
  heading: { color: colors.gold, fontSize: 18, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  strong: { color: colors.text, fontWeight: '700' },
  borderRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8 },
});

export function ProfitabilityPage() {
  const capabilities = useQuery({
    queryKey: ['pos-capabilities'],
    queryFn: () => api.capabilities(),
  });
  const enabled =
    capabilities.data?.some((item) => item.key === 'profitability_reports' && item.enabled) ===
    true;
  const [from, setFrom] = useState(localDate(6));
  const [to, setTo] = useState(localDate());
  const [report, setReport] = useState<ProfitabilityReport | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(nextPage = 1) {
    setBusy(true);
    setError('');
    try {
      setReport(await api.profitabilityReport(from, to, nextPage));
      setPage(nextPage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el reporte.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (enabled) void load();
  }, [enabled]);
  return (
    <ScrollScreen>
      <SectionTitle title="Rentabilidad" />
      <Text style={shared.subtitle}>Corte por día local · America/Mexico_City</Text>
      <Card>
        <Field
          label="Desde (AAAA-MM-DD)"
          value={from}
          onChangeText={setFrom}
          placeholder="2026-09-01"
        />
        <Field
          label="Hasta (AAAA-MM-DD, inclusivo)"
          value={to}
          onChangeText={setTo}
          placeholder="2026-09-30"
        />
        <Button
          label={busy ? 'Consultando…' : 'Consultar'}
          disabled={busy || !enabled}
          onPress={() => void load()}
        />
        {!enabled ? (
          <Notice kind="warning">
            Los reportes de rentabilidad están deshabilitados hasta activar esta capacidad en el
            servidor.
          </Notice>
        ) : null}
        {busy && <ActivityIndicator color={colors.gold} />}
        {error ? <Notice kind="error">{error}</Notice> : null}
      </Card>
      {report && (
        <>
          <Card>
            <Text style={styles.heading}>Resultados</Text>
            {Object.entries(report.summary).map(([key, value]) => (
              <View key={key} style={styles.row}>
                <Text style={shared.text}>{labels[key] ?? key}</Text>
                <Text style={styles.strong}>
                  {key === 'deliveredOrders' ? value : money(value)}
                </Text>
              </View>
            ))}
          </Card>
          <Card>
            <Text style={styles.heading}>Detalle del periodo</Text>
            <Text style={shared.subtitle}>{report.totalRows} movimientos</Text>
            {report.rows.map((row) => (
              <View key={`${row.kind}:${row.id}`} style={[styles.row, styles.borderRow]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.strong}>
                    {row.kind.toUpperCase()} · {row.description}
                  </Text>
                  <Text style={shared.subtitle}>
                    {new Date(row.occurredAt).toLocaleString('es-MX')}
                  </Text>
                </View>
                <View>
                  <Text style={shared.text}>{money(row.amountCents)}</Text>
                  <Text style={shared.subtitle}>Costo {money(row.costCents)}</Text>
                </View>
              </View>
            ))}
            <View style={styles.row}>
              <Button
                label="Anterior"
                secondary
                disabled={busy || page <= 1}
                onPress={() => void load(page - 1)}
              />
              <Text style={shared.text}>Página {page}</Text>
              <Button
                label="Siguiente"
                secondary
                disabled={busy || page * report.pageSize >= report.totalRows}
                onPress={() => void load(page + 1)}
              />
            </View>
          </Card>
          <Card>
            <Text style={styles.heading}>Por modalidad y pago</Text>
            {report.byFulfillment.map((row) => (
              <Text key={row.key} style={shared.text}>
                {row.key}: {row.orders} pedidos · {money(row.amountCents)}
              </Text>
            ))}
            {report.byPayment.map((row) => (
              <Text key={row.key} style={shared.text}>
                {row.key}: {money(row.amountCents)}
              </Text>
            ))}
          </Card>
          <Card>
            <Text style={styles.heading}>Por producto</Text>
            {report.byProduct.map((row) => (
              <Text key={row.key} style={shared.text}>
                {row.key}: {row.quantity} · {money(row.amountCents)}
              </Text>
            ))}
          </Card>
        </>
      )}
    </ScrollScreen>
  );
}

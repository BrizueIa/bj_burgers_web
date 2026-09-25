import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BjApiError, createIdempotencyKey } from '@bj/api-client';
import type { UnifiedOrderConfirm } from '@bj/contracts';
import type { BusinessState } from '@bj/contracts';
import { api } from './api';
import { businessLoadErrorMessage } from './business-error';
import { centsFromInput, money, numberValue, quantity, startOfToday } from './format';
import { Button, Card, Field, Loading, Notice, Pill, ScrollScreen, SectionTitle } from './ui';
import { colors, shared } from './theme';

export type BusinessSection = 'home' | 'pos' | 'inventory' | 'recipes' | 'reports';
export type BusinessMode =
  'ingredient' | 'purchase' | 'sale' | 'waste' | 'count' | 'expense' | 'recipe' | 'production';
const titles: Record<BusinessSection, string> = {
  home: 'Mi negocio',
  pos: 'Punto de venta',
  inventory: 'Inventario',
  recipes: 'Recetas y precios',
  reports: 'Reportes',
};

function dayWindow() {
  const from = startOfToday();
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}
function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function inclusiveDateRange(range: { from: Date; to: Date }) {
  const last = new Date(range.to);
  if (last.getHours() === 0 && last.getMinutes() === 0 && last.getSeconds() === 0)
    last.setDate(last.getDate() - 1);
  return { from: localDate(range.from), to: localDate(last) };
}
function windowFor(days: number) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}
function useBusiness(range: { from: Date; to: Date }) {
  return useQuery({
    queryKey: ['business', range.from.toISOString(), range.to.toISOString()],
    queryFn: () => api.business(range.from, range.to),
  });
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card style={styles.metric}>
      <Text style={shared.label}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {detail ? <Text style={shared.subtitle}>{detail}</Text> : null}
    </Card>
  );
}

function DateWindow({
  range,
  onChange,
}: {
  range: { from: Date; to: Date };
  onChange(value: { from: Date; to: Date }): void;
}) {
  return (
    <View style={styles.dateBar}>
      <Text style={shared.subtitle}>
        {range.from.toLocaleDateString('es-MX')} — {range.to.toLocaleDateString('es-MX')}
      </Text>
      <View style={styles.row}>
        <Pill
          label="Hoy"
          selected={range.to.getTime() - range.from.getTime() < 2 * 86_400_000}
          onPress={() => onChange(dayWindow())}
        />
        <Pill label="7 días" selected={false} onPress={() => onChange(windowFor(7))} />
        <Pill label="Mes" selected={false} onPress={() => onChange(windowFor(30))} />
      </View>
    </View>
  );
}

export function BusinessPage({ section }: { section: BusinessSection }) {
  const [range, setRange] = useState(dayWindow);
  const { data, error, isLoading, refetch, isFetching } = useBusiness(range);
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.capabilities(),
    staleTime: 60_000,
  });
  const profitabilityEnabled = capabilities.data?.some(
    (capability) => capability.key === 'profitability_reports' && capability.enabled,
  );
  const dates = inclusiveDateRange(range);
  const dashboardReport = useQuery({
    queryKey: ['dashboard-profitability', dates.from, dates.to],
    queryFn: () => api.profitabilityReport(dates.from, dates.to, 1),
    enabled: section === 'home' && profitabilityEnabled === true,
  });
  if (isLoading) return <Loading />;
  if (!data)
    return (
      <ScrollScreen>
        <SectionTitle title={titles[section]} />
        <Notice kind="error">
          {businessLoadErrorMessage(error, 'No se pudo consultar el negocio.')}
        </Notice>
        <Button label="Reintentar" onPress={() => void refetch()} />
      </ScrollScreen>
    );
  const report = data.report;
  const unifiedReport = dashboardReport.data?.summary;
  const revenue = unifiedReport?.grossSalesCents ?? numberValue(report.revenue_cents);
  const cost = unifiedReport?.costOfGoodsSoldCents ?? numberValue(report.cost_cents);
  const expenses = unifiedReport?.operatingExpensesCents ?? numberValue(report.expenses_cents);
  const waste = unifiedReport?.wasteCents ?? numberValue(report.waste_cents);
  const salesCount = unifiedReport?.deliveredOrders ?? report.sales_count;
  const lowStock = data.ingredients.filter(
    (ingredient) => numberValue(ingredient.stock) <= numberValue(ingredient.minimum),
  ).length;
  const stockLedgerEnabled = capabilities.data?.some(
    (capability) => capability.key === 'stock_ledger' && capability.enabled,
  );
  const productionEnabled = capabilities.data?.some(
    (capability) => capability.key === 'production' && capability.enabled,
  );
  const unifiedOrdersEnabled = capabilities.data?.some(
    (capability) => capability.key === 'unified_orders' && capability.enabled,
  );
  const openEditor = (mode: BusinessMode, productId?: string) =>
    router.push({
      pathname: '/(app)/business/[mode]',
      params: { mode, ...(productId ? { productId } : {}) },
    });
  return (
    <ScrollScreen>
      <SectionTitle
        title={titles[section]}
        action={
          <Button
            label={isFetching ? 'Actualizando…' : 'Actualizar'}
            secondary
            disabled={isFetching}
            onPress={() => {
              void refetch();
              if (section === 'home' && profitabilityEnabled) void dashboardReport.refetch();
            }}
          />
        }
      />
      {section === 'home' || section === 'reports' ? (
        <DateWindow range={range} onChange={setRange} />
      ) : null}
      {section === 'home' || section === 'reports' ? (
        <View style={styles.metrics}>
          <Metric
            label="Ventas cobradas"
            value={money(revenue)}
            detail={`${salesCount} ventas entregadas`}
          />
          <Metric label="Costo de ventas" value={money(cost)} />
          <Metric
            label="Utilidad bruta"
            value={money(revenue - cost)}
            detail={
              revenue ? `Margen ${(((revenue - cost) / revenue) * 100).toFixed(1)}%` : 'Sin ventas'
            }
          />
          <Metric
            label="Resultado registrado"
            value={money(unifiedReport?.operatingResultCents ?? revenue - cost - expenses - waste)}
            detail="Después de gastos y mermas"
          />
        </View>
      ) : null}
      {section === 'home' ? (
        <>
          <View style={styles.actions}>
            <Button label="Nueva venta · POS" onPress={() => router.push('/(app)/pos')} />
            <Button label="Registrar compra" secondary onPress={() => openEditor('purchase')} />
            <Button label="Comandas" secondary onPress={() => router.push('/(app)/orders')} />
            <Button label="Registrar gasto" secondary onPress={() => openEditor('expense')} />
          </View>
          <Card>
            <Text style={shared.text}>{lowStock} ingredientes en mínimo o agotados</Text>
            <Text style={shared.subtitle}>
              {data.products.filter((product) => product.cost_cents === null).length} productos
              pendientes de costear
            </Text>
          </Card>
          {dashboardReport.error ? (
            <Notice kind="warning">
              No se pudo actualizar el resumen del POS; las cifras mostradas pueden incluir solo los
              registros anteriores.
            </Notice>
          ) : null}
          <Notice>
            {unifiedOrdersEnabled
              ? 'Las ventas nuevas se cotizan y reservan como comandas únicas. El cobro se integra desde Caja.'
              : 'Empieza con ingredientes, compras y recetas. El POS unificado permanece deshabilitado hasta conciliar existencias.'}
          </Notice>
        </>
      ) : null}
      {section === 'pos' ? (
        <>
          <Text style={shared.subtitle}>
            Cotiza y registra ventas desde el carrito del POS. Preparación, pago y entrega se
            consultan desde Comandas y Caja.
          </Text>
          <Button
            label="Abrir POS · Nueva venta"
            disabled={!unifiedOrdersEnabled}
            onPress={() => router.push('/(app)/pos')}
          />
          <Button label="Ver comandas" secondary onPress={() => router.push('/(app)/orders')} />
          {data.products.map((product) => (
            <Card key={product.id}>
              <Text style={shared.text}>{product.name}</Text>
              <Text style={shared.subtitle}>
                {product.cost_cents === null
                  ? 'Configura receta y compras para vender'
                  : `Costo ${money(product.cost_cents)} · margen ${numberValue(product.margin_percent).toFixed(1)}%`}
              </Text>
              <Text style={styles.price}>{money(product.price_cents)}</Text>
            </Card>
          ))}
        </>
      ) : null}
      {section === 'inventory' ? (
        <>
          <View style={styles.actions}>
            <Button label="Ingrediente" onPress={() => openEditor('ingredient')} />
            <Button label="Compra" secondary onPress={() => openEditor('purchase')} />
            <Button label="Merma" secondary onPress={() => openEditor('waste')} />
            {stockLedgerEnabled ? (
              <Button label="Conteo" secondary onPress={() => openEditor('count')} />
            ) : null}
          </View>
          {!stockLedgerEnabled ? (
            <Notice kind="warning">
              El libro mayor está integrado, pero los conteos y reservas se habilitan después de
              conciliar las existencias actuales.
            </Notice>
          ) : null}
          <Metric
            label="Valor actual del inventario"
            value={money(
              data.ingredients.reduce(
                (sum, ingredient) => sum + numberValue(ingredient.value_cents),
                0,
              ),
            )}
          />
          {data.ingredients.length === 0 ? (
            <Notice>
              Agrega ingredientes en gramos, mililitros o piezas. Incluye empaques y consumibles en
              las recetas.
            </Notice>
          ) : (
            data.ingredients.map((ingredient) => (
              <Card key={ingredient.id}>
                <Text style={shared.text}>
                  {ingredient.name}
                  {numberValue(ingredient.stock) <= numberValue(ingredient.minimum)
                    ? ' · Bajo mínimo'
                    : ''}
                </Text>
                <Text style={shared.subtitle}>
                  {quantity(ingredient.stock)} {ingredient.unit} · mínimo{' '}
                  {quantity(ingredient.minimum)}
                  {numberValue(ingredient.reserved) > 0
                    ? `\nReservado ${quantity(ingredient.reserved)} · disponible ${quantity(numberValue(ingredient.stock) - numberValue(ingredient.reserved))}`
                    : ''}
                  {ingredient.unit_cost === null
                    ? '\nSin costo: registra una compra'
                    : `\nCosto promedio ${money(ingredient.unit_cost)} / ${ingredient.unit}`}
                </Text>
                <Text style={styles.price}>{money(ingredient.value_cents)}</Text>
              </Card>
            ))
          )}
        </>
      ) : null}
      {section === 'recipes' ? (
        <>
          <Text style={shared.subtitle}>
            El precio sugerido usa tu margen objetivo. Se basa en el promedio ponderado de
            existencias y en el último costo cuando el ingrediente está agotado.
          </Text>
          {data.products.map((product) => (
            <Card key={product.id}>
              <Text style={shared.text}>{product.name}</Text>
              <Text style={shared.subtitle}>
                {product.cost_cents === null
                  ? 'Costo pendiente · configurar receta'
                  : `Costo ${money(product.cost_cents)} · sugerido ${money(product.recommended_price_cents)}\nGanancia bruta ${money(product.price_cents - product.cost_cents)} · margen ${numberValue(product.margin_percent).toFixed(1)}%`}
              </Text>
              <Text style={styles.price}>Lista {money(product.price_cents)}</Text>
              <Button
                label={
                  data.recipes.some((line) => line.product_id === product.id)
                    ? 'Editar receta y precio'
                    : 'Crear receta'
                }
                secondary
                onPress={() => openEditor('recipe', product.id)}
              />
              {productionEnabled ? (
                <Button
                  label="Registrar lote"
                  secondary
                  onPress={() => openEditor('production', product.id)}
                />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
      {section === 'reports' ? (
        <>
          <Metric
            label="Compras recibidas"
            value={money(report.purchases_cents)}
            detail="Ingresan a inventario; el costo se reconoce al vender o registrar merma."
          />
          <Metric label="Gastos registrados" value={money(expenses)} />
          <Metric label="Mermas" value={money(waste)} />
          <Button label="Registrar gasto" secondary onPress={() => openEditor('expense')} />
          <Text style={shared.text}>Movimientos del período · últimos 200</Text>
          {data.entries.length === 0 ? (
            <Text style={shared.subtitle}>No hay movimientos en este período.</Text>
          ) : (
            data.entries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
          )}
        </>
      ) : null}
    </ScrollScreen>
  );
}

function EntryCard({ entry }: { entry: BusinessState['entries'][number] }) {
  const label = { sale: 'Venta', purchase: 'Compra', waste: 'Merma', expense: 'Gasto' }[entry.kind];
  const amount = entry.kind === 'waste' ? entry.cost_cents : entry.total_cents;
  return (
    <Card>
      <Text style={shared.text}>
        {label} · {money(amount)}
      </Text>
      <Text style={shared.subtitle}>
        {entry.description}\n{new Date(entry.created_at).toLocaleString('es-MX')}{' '}
        {entry.payment
          ? `· ${{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[entry.payment]}`
          : ''}
      </Text>
      {entry.kind === 'sale' ? (
        <Text style={shared.subtitle}>
          Costo histórico {money(entry.cost_cents)} · utilidad{' '}
          {money(entry.total_cents - entry.cost_cents)}
        </Text>
      ) : null}
    </Card>
  );
}

type Line = { id: string; name: string; quantity: number; totalCents?: number };
export function BusinessEditor({ mode, productId }: { mode: BusinessMode; productId?: string }) {
  const range = useMemo(dayWindow, []);
  const { data, isLoading, error } = useBusiness(range);
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.capabilities(),
    staleTime: 60_000,
  });
  const client = useQueryClient();
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<'g' | 'ml' | 'pz'>('g');
  const [minimum, setMinimum] = useState('0');
  const [payment, setPayment] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [fulfillment, setFulfillment] = useState<'counter' | 'pickup' | 'delivery'>('counter');
  const [manualDiscount, setManualDiscount] = useState('');
  const [manualDiscountReason, setManualDiscountReason] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [streetAndNumber, setStreetAndNumber] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [lineQuantity, setLineQuantity] = useState('');
  const [lineTotal, setLineTotal] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [targetMargin, setTargetMargin] = useState('65');
  const [overhead, setOverhead] = useState('0');
  const [price, setPrice] = useState('');
  const [pending, setPending] = useState<Record<string, unknown>>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const product = data?.products.find((item) => item.id === productId);
  const hasExistingRecipe = Boolean(
    product && data?.recipes.some((line) => line.product_id === product.id),
  );
  const recipeVersionsEnabled = capabilities.data?.some(
    (capability) => capability.key === 'recipe_versions' && capability.enabled,
  );
  const unifiedOrdersEnabled = capabilities.data?.some(
    (capability) => capability.key === 'unified_orders' && capability.enabled,
  );
  useEffect(() => {
    if (mode !== 'recipe' || !data || !product || lines.length) return;
    setTargetMargin(String(product.target_margin ?? 65));
    setOverhead(String((product.overhead_cents ?? 0) / 100));
    setPrice(String(product.price_cents / 100));
    setLines(
      data.recipes
        .filter((line) => line.product_id === product.id)
        .map((line) => ({
          id: line.ingredient_id,
          name:
            data.ingredients.find((ingredient) => ingredient.id === line.ingredient_id)?.name ??
            line.ingredient_id,
          quantity: numberValue(line.quantity),
        })),
    );
  }, [data, lines.length, mode, product]);
  if (isLoading) return <Loading />;
  if (!data)
    return (
      <ScrollScreen>
        <Notice kind="error">
          {businessLoadErrorMessage(error, 'No se pudo cargar el negocio.')}
        </Notice>
      </ScrollScreen>
    );
  const source = mode === 'sale' ? data.products : data.ingredients;
  const selected = source.find((item) => item.id === selectedId);
  const requiresLines =
    mode === 'purchase' || mode === 'sale' || mode === 'recipe' || mode === 'count';
  const addLine = () => {
    setMessage(undefined);
    const quantityValue = Number(lineQuantity.replace(',', '.'));
    if (!selected || !Number.isFinite(quantityValue) || (mode !== 'count' && quantityValue <= 0)) {
      setMessage('Selecciona un artículo y escribe una cantidad válida.');
      return;
    }
    const cents = centsFromInput(lineTotal);
    if (mode === 'purchase' && cents <= 0) {
      setMessage('Escribe el total pagado por este ingrediente.');
      return;
    }
    if (lines.some((line) => line.id === selected.id)) {
      setMessage('Ese artículo ya está agregado.');
      return;
    }
    if (mode === 'count' && lines.length) {
      setMessage('Un conteo confirma un ingrediente a la vez.');
      return;
    }
    setLines((current) => [
      ...current,
      {
        id: selected.id,
        name: selected.name,
        quantity: quantityValue,
        ...(mode === 'purchase' ? { totalCents: cents } : {}),
      },
    ]);
    setSelectedId('');
    setLineQuantity('');
    setLineTotal('');
  };
  const build = (): Record<string, unknown> | undefined => {
    if (mode === 'ingredient') {
      if (!description.trim()) {
        setMessage('Escribe el nombre del ingrediente.');
        return;
      }
      return { name: description.trim(), unit, minimum: Number(minimum.replace(',', '.')) || 0 };
    }
    if (mode === 'recipe') {
      if (!product || !lines.length) {
        setMessage('Agrega al menos un ingrediente a la receta.');
        return;
      }
      return {
        productId: product.id,
        targetMargin: Math.round(Number(targetMargin) || 0),
        overheadCents: centsFromInput(overhead),
        priceCents: centsFromInput(price),
        lines: lines.map((line) => ({ ingredientId: line.id, quantity: line.quantity })),
        idempotencyKey: createIdempotencyKey(),
      };
    }
    if (mode === 'production') {
      const output = Number(lineQuantity.replace(',', '.'));
      if (!product || !Number.isFinite(output) || output <= 0) {
        setMessage('Indica el rendimiento real del lote.');
        return;
      }
      if (!description.trim()) {
        setMessage('Indica el motivo o referencia del lote.');
        return;
      }
      return {
        idempotencyKey: createIdempotencyKey(),
        productId: product.id,
        outputQuantity: output.toFixed(3),
        outputUnit: unit,
        reason: description.trim(),
      };
    }
    if (!description.trim() && mode !== 'sale') {
      setMessage(
        mode === 'expense' ? 'Describe el gasto.' : 'Escribe el proveedor, cliente o motivo.',
      );
      return;
    }
    if (mode === 'expense') {
      const totalCents = centsFromInput(lineTotal);
      if (totalCents <= 0) {
        setMessage('Escribe un importe válido.');
        return;
      }
      return {
        kind: 'expense',
        description: description.trim(),
        totalCents,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    if (mode === 'waste') {
      const value = Number(lineQuantity.replace(',', '.'));
      if (!selected || !Number.isFinite(value) || value <= 0) {
        setMessage('Selecciona un ingrediente y escribe la cantidad de merma.');
        return;
      }
      return {
        kind: 'waste',
        description: description.trim(),
        ingredientId: selected.id,
        quantity: value,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    if (mode === 'count') {
      const line = lines[0];
      if (!line) {
        setMessage('Selecciona un ingrediente y registra la cantidad contada.');
        return;
      }
      return {
        ingredientId: line.id,
        countedQuantity: line.quantity.toFixed(3),
        ...(lineTotal.trim() ? { unitCostCents: String(centsFromInput(lineTotal)) } : {}),
        reason: description.trim(),
        idempotencyKey: createIdempotencyKey(),
      };
    }
    if (!lines.length) {
      setMessage('Agrega al menos una línea.');
      return;
    }
    if (mode === 'purchase')
      return {
        kind: 'purchase',
        description: description.trim(),
        lines: lines.map((line) => ({
          ingredientId: line.id,
          quantity: line.quantity,
          totalCents: line.totalCents,
        })),
        idempotencyKey: createIdempotencyKey(),
      };
    const expectedTotalCents = lines.reduce(
      (sum, line) =>
        sum + (data.products.find((item) => item.id === line.id)?.price_cents ?? 0) * line.quantity,
      0,
    );
    if (unifiedOrdersEnabled)
      return {
        fulfillment,
        customerName: description.trim(),
        neighborhood: fulfillment === 'delivery' ? neighborhood.trim() : '',
        streetAndNumber: fulfillment === 'delivery' ? streetAndNumber.trim() : '',
        manualDiscountCents: centsFromInput(manualDiscount),
        manualDiscountReason: manualDiscountReason.trim(),
        items: lines.map((line) => ({
          productId: line.id,
          quantity: line.quantity,
          removedIngredients: [],
          modifierIds: [],
          combo: false,
          note: '',
        })),
        idempotencyKey: createIdempotencyKey(),
      };
    return {
      kind: 'sale',
      description: description.trim(),
      payment,
      expectedTotalCents,
      lines: lines.map((line) => ({ productId: line.id, quantity: line.quantity })),
      idempotencyKey: createIdempotencyKey(),
    };
  };
  const save = async () => {
    const input = pending ?? build();
    if (!input) return;
    setPending(input);
    setBusy(true);
    setMessage(undefined);
    try {
      if (mode === 'ingredient')
        await api.addIngredient(
          input as { name: string; unit: 'g' | 'ml' | 'pz'; minimum: number },
        );
      else if (mode === 'recipe') {
        if (recipeVersionsEnabled)
          await api.createRecipeVersion({
            idempotencyKey: input.idempotencyKey as string,
            productId: input.productId as string,
            targetMargin: input.targetMargin as number,
            overheadCents: input.overheadCents as number,
            priceCents: input.priceCents as number,
            components: (input.lines as Array<{ ingredientId: string; quantity: number }>).map(
              (line) => ({
                kind: 'ingredient' as const,
                ingredientId: line.ingredientId,
                quantity: line.quantity.toFixed(3),
                removable: false,
                extra: false,
              }),
            ),
          });
        else await api.saveRecipe(input as never);
      } else if (mode === 'production') {
        await api.createProductionBatch(input as never);
      } else if (mode === 'count') await api.countStock(input as never);
      else if (mode === 'sale' && unifiedOrdersEnabled) {
        if (!('quotedTotalCents' in input)) {
          const quote = await api.quoteUnifiedOrder(
            input as Omit<UnifiedOrderConfirm, 'idempotencyKey' | 'quotedTotalCents'>,
          );
          setPending({ ...input, quotedTotalCents: quote.totalCents });
          setMessage(
            'Cotización confirmada por ' +
              money(quote.totalCents) +
              '. Presiona confirmar para crear la comanda.',
          );
          return;
        }
        const order = await api.confirmUnifiedOrder(input as UnifiedOrderConfirm);
        await client.invalidateQueries({ queryKey: ['orders'] });
        await client.invalidateQueries({ queryKey: ['business'] });
        router.replace({ pathname: '/(app)/orders/[id]', params: { id: order.id } });
        return;
      } else await api.recordBusinessEntry(input);
      await client.invalidateQueries({ queryKey: ['business'] });
      router.back();
    } catch (cause) {
      if (cause instanceof BjApiError && !cause.ambiguous) setPending(undefined);
      setMessage(
        cause instanceof BjApiError
          ? cause.message
          : 'No se pudo guardar. Reintenta la misma operación para evitar duplicarla.',
      );
    } finally {
      setBusy(false);
    }
  };
  const heading = {
    ingredient: 'Nuevo ingrediente',
    purchase: 'Registrar compra',
    sale: 'Registrar venta',
    waste: 'Registrar merma',
    count: 'Registrar conteo',
    expense: 'Registrar gasto',
    recipe: `${hasExistingRecipe ? 'Editar receta' : 'Crear receta'} · ${product?.name ?? ''}`,
    production: `Lote · ${product?.name ?? ''}`,
  }[mode];
  return (
    <ScrollScreen>
      <SectionTitle title={heading} />
      {mode === 'recipe' && !hasExistingRecipe ? (
        <Notice>
          Agrega los ingredientes y cantidades por producto. Los ingredientes del menú ya están
          registrados con existencia en cero; captura una compra para registrar su costo real.
        </Notice>
      ) : null}
      <Text style={shared.subtitle}>
        {mode === 'sale'
          ? unifiedOrdersEnabled
            ? 'Primero cotiza en el servidor y confirma la misma solicitud. La comanda reserva existencias; el cobro se registra en Caja.'
            : 'El servidor confirma el precio y descuenta el inventario. Una respuesta incierta conserva esta misma operación para reintentarla.'
          : mode === 'recipe'
            ? 'El costo y precio sugerido se actualizarán usando las compras registradas.'
            : mode === 'production'
              ? 'El servidor consumirá los insumos de la receta activa y registrará el costo del lote.'
              : ''}
      </Text>
      {mode === 'ingredient' ? (
        <>
          <Field label="Nombre" value={description} onChangeText={setDescription} />
          <Text style={shared.label}>Unidad base</Text>
          <View style={styles.row}>
            {(['g', 'ml', 'pz'] as const).map((value) => (
              <Pill
                key={value}
                label={
                  value === 'g' ? 'Gramos (g)' : value === 'ml' ? 'Mililitros (ml)' : 'Piezas (pz)'
                }
                selected={unit === value}
                onPress={() => setUnit(value)}
              />
            ))}
          </View>
          <Field
            label="Existencia mínima"
            keyboardType="decimal-pad"
            value={minimum}
            onChangeText={setMinimum}
          />
        </>
      ) : null}
      {mode !== 'ingredient' && mode !== 'recipe' ? (
        <Field
          label={
            mode === 'purchase'
              ? 'Proveedor / folio de compra'
              : mode === 'sale'
                ? 'Cliente o referencia de venta'
                : mode === 'expense'
                  ? 'Descripción del gasto'
                  : mode === 'count'
                    ? 'Motivo del conteo'
                    : mode === 'production'
                      ? 'Motivo o referencia del lote'
                      : 'Motivo de la merma'
          }
          value={description}
          onChangeText={(value) => {
            setDescription(value);
          }}
        />
      ) : null}
      {mode === 'sale' && !unifiedOrdersEnabled ? (
        <>
          <Text style={shared.label}>Forma de pago</Text>
          <View style={styles.row}>
            {(
              [
                ['cash', 'Efectivo'],
                ['card', 'Tarjeta'],
                ['transfer', 'Transferencia'],
              ] as const
            ).map(([value, label]) => (
              <Pill
                key={value}
                label={label}
                selected={payment === value}
                onPress={() => setPayment(value)}
              />
            ))}
          </View>
        </>
      ) : null}
      {mode === 'sale' && unifiedOrdersEnabled ? (
        <>
          <Text style={shared.label}>Modalidad</Text>
          <View style={styles.row}>
            {(
              [
                ['counter', 'Mostrador'],
                ['pickup', 'Recoger'],
                ['delivery', 'Domicilio'],
              ] as const
            ).map(([value, label]) => (
              <Pill
                key={value}
                label={label}
                selected={fulfillment === value}
                onPress={() => {
                  setFulfillment(value);
                }}
              />
            ))}
          </View>
          {fulfillment === 'delivery' ? (
            <>
              <Field
                label="Colonia"
                value={neighborhood}
                onChangeText={(value) => {
                  setNeighborhood(value);
                }}
              />
              <Field
                label="Dirección"
                value={streetAndNumber}
                onChangeText={(value) => {
                  setStreetAndNumber(value);
                }}
              />
            </>
          ) : null}
          <Field
            label="Descuento manual (MXN)"
            keyboardType="decimal-pad"
            value={manualDiscount}
            onChangeText={(value) => {
              setManualDiscount(value);
            }}
          />
          <Field
            label="Motivo del descuento"
            value={manualDiscountReason}
            onChangeText={(value) => {
              setManualDiscountReason(value);
            }}
          />
        </>
      ) : null}
      {mode === 'recipe' ? (
        <>
          {recipeVersionsEnabled ? (
            <Notice>
              La receta se guardará como una nueva versión y actualizará el costo y el precio de
              lista del producto.
            </Notice>
          ) : null}
          <Field
            label="Margen objetivo (%)"
            keyboardType="number-pad"
            value={targetMargin}
            onChangeText={setTargetMargin}
          />
          <Field
            label="Empaque u otros costos por producto (MXN)"
            keyboardType="decimal-pad"
            value={overhead}
            onChangeText={setOverhead}
          />
          <Field
            label="Precio de lista (MXN)"
            keyboardType="decimal-pad"
            value={price}
            onChangeText={setPrice}
          />
        </>
      ) : null}
      {mode === 'production' ? (
        <>
          <Field
            label="Rendimiento real"
            keyboardType="decimal-pad"
            value={lineQuantity}
            onChangeText={setLineQuantity}
          />
          <Text style={shared.label}>Unidad de la preparación</Text>
          <View style={styles.row}>
            {(['g', 'ml', 'pz'] as const).map((value) => (
              <Pill
                key={value}
                label={value}
                selected={unit === value}
                onPress={() => setUnit(value)}
              />
            ))}
          </View>
        </>
      ) : null}
      {mode === 'expense' ? (
        <Field
          label="Importe (MXN)"
          keyboardType="decimal-pad"
          value={lineTotal}
          onChangeText={setLineTotal}
        />
      ) : null}
      {mode === 'count' ? (
        <Field
          label="Costo unitario para sobrante, si aplica (MXN)"
          keyboardType="decimal-pad"
          value={lineTotal}
          onChangeText={setLineTotal}
        />
      ) : null}
      {requiresLines || mode === 'waste' ? (
        <Card>
          <Text style={shared.text}>{mode === 'sale' ? 'Productos' : 'Ingredientes'}</Text>
          <ScrollView horizontal contentContainerStyle={styles.row}>
            {source.map((item) => (
              <Pill
                key={item.id}
                label={item.name}
                selected={selectedId === item.id}
                onPress={() => setSelectedId(item.id)}
              />
            ))}
          </ScrollView>
          <Field
            label={
              mode === 'sale'
                ? 'Cantidad de productos'
                : mode === 'count'
                  ? 'Existencia contada (puede ser negativa)'
                  : 'Cantidad en unidad base'
            }
            keyboardType={mode === 'count' ? 'default' : 'decimal-pad'}
            value={lineQuantity}
            onChangeText={setLineQuantity}
          />
          {mode === 'purchase' ? (
            <Field
              label="Total pagado por este ingrediente (MXN)"
              keyboardType="decimal-pad"
              value={lineTotal}
              onChangeText={setLineTotal}
            />
          ) : null}
          {requiresLines ? (
            <Button
              label="Agregar línea"
              secondary
              disabled={mode === 'sale' && Boolean(pending)}
              onPress={addLine}
            />
          ) : null}
          {lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <Text style={shared.text}>
                {line.name} · {quantity(line.quantity)}{' '}
                {mode === 'sale'
                  ? 'pz'
                  : (data.ingredients.find((item) => item.id === line.id)?.unit ?? '')}
                {line.totalCents !== undefined ? ` · ${money(line.totalCents)}` : ''}
              </Text>
              <Button
                label="Quitar"
                secondary
                disabled={mode === 'sale' && Boolean(pending)}
                onPress={() => {
                  setLines((current) => current.filter((item) => item.id !== line.id));
                }}
              />
            </View>
          ))}
        </Card>
      ) : null}
      {mode === 'sale' && lines.length ? (
        <Metric
          label="Total a cobrar"
          value={money(
            lines.reduce(
              (sum, line) =>
                sum +
                (data.products.find((item) => item.id === line.id)?.price_cents ?? 0) *
                  line.quantity,
              0,
            ),
          )}
        />
      ) : null}
      {message ? (
        <Notice kind={message.startsWith('Cotización') ? 'info' : 'error'}>{message}</Notice>
      ) : null}
      {pending && !busy ? (
        <Notice kind="warning">
          La respuesta no se confirmó. Reintenta esta misma operación para no duplicarla.
        </Notice>
      ) : null}
      <Button
        label={
          busy
            ? 'Guardando…'
            : mode === 'sale' && unifiedOrdersEnabled && pending && 'quotedTotalCents' in pending
              ? 'Confirmar comanda cotizada'
              : pending
                ? 'Reintentar operación'
                : mode === 'sale'
                  ? unifiedOrdersEnabled
                    ? 'Cotizar comanda'
                    : 'Confirmar cobro y descontar inventario'
                  : 'Guardar'
        }
        disabled={busy}
        onPress={() => void save()}
      />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  metrics: { gap: 10 },
  metric: { minHeight: 95 },
  metricValue: { color: colors.gold, fontSize: 25, fontWeight: '800' },
  dateBar: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  actions: { gap: 8 },
  price: { color: colors.gold, fontSize: 18, fontWeight: '800' },
  line: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
});

import {
  businessStateResponseSchema,
  capabilitiesResponseSchema,
  catalogSchema,
  operatorDeviceActivationResponseSchema,
  orderDraftSchema,
  orderResponseSchema,
  ordersResponseSchema,
  spinCodeIssueResponseSchema,
  stockLedgerStateSchema,
  stockMutationResponseSchema,
  stockReservationReleaseResponseSchema,
  stockReservationResponseSchema,
  type BusinessState,
  type Capability,
  type Order,
  type OrderCreateRequest,
  type OrderDraft,
  type OrderStatus,
  type StockCountRequest,
  type StockReservationRequest,
  type StockReservationResolveRequest,
  type StockWasteRequest,
  type PurchaseCreate,
  recipeVersionMutationResponseSchema,
  recipeVersionStateSchema,
  productionBatchResponseSchema,
  type RecipeVersionCreate,
  type ProductionBatchCreate,
  type RecipeVersionState,
  unifiedOrderQuoteResponseSchema,
  type UnifiedOrderConfirm,
} from '@bj/contracts';
import { z, type ZodType } from 'zod';

export interface CredentialStore {
  getCredential(): Promise<string | null>;
  saveCredential(input: { credential: string; deviceName: string }): Promise<void>;
  clearCredential(): Promise<void>;
}

export class BjApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BjApiError';
  }

  get unauthorized() {
    return this.statusCode === 401;
  }

  get ambiguous() {
    return this.statusCode === undefined || this.statusCode >= 500;
  }
}

export interface BjApiClientOptions {
  baseUrl: string;
  credentialStore: CredentialStore;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type RequestInitWithTimeout = RequestInit & { timeoutMs?: number };

const errorBodySchema = z.object({ message: z.string() }).partial();

function trimBaseUrl(value: string) {
  return value.replace(/\/$/, '');
}

export function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
    crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class BjApiClient {
  private readonly requestFetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(private readonly options: BjApiClientOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl);
    this.requestFetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 25_000;
  }

  private async headers(protectedRoute = true) {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (!protectedRoute) return headers;
    const credential = await this.options.credentialStore.getCredential();
    if (!credential) throw new BjApiError('Este dispositivo aún no está vinculado.', 401);
    return { ...headers, authorization: `Bearer ${credential}` };
  }

  private async request<T>(
    path: string,
    schema: ZodType<T>,
    init: RequestInitWithTimeout = {},
    protectedRoute = true,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? this.timeoutMs);
    try {
      const response = await this.requestFetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(await this.headers(protectedRoute)), ...init.headers },
        signal: init.signal ?? controller.signal,
      });
      const raw = response.status === 204 ? {} : await response.json().catch(() => null);
      if (!response.ok) {
        const body = errorBodySchema.safeParse(raw);
        if (response.status === 401) await this.options.credentialStore.clearCredential();
        throw new BjApiError(
          body.success && body.data.message
            ? body.data.message
            : 'No fue posible completar la operación.',
          response.status,
        );
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new BjApiError('La respuesta del servidor no tiene el formato esperado.');
      return parsed.data;
    } catch (error) {
      if (error instanceof BjApiError) throw error;
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'La operación tardó demasiado.'
          : 'No hay conexión con el servidor.';
      throw new BjApiError(message, undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private post<T>(path: string, schema: ZodType<T>, body: unknown, protectedRoute = true) {
    return this.request(
      path,
      schema,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      protectedRoute,
    );
  }

  async activateDevice(deviceId: string, pairingCode: string) {
    const result = await this.post(
      '/operator/devices/activate',
      operatorDeviceActivationResponseSchema,
      { deviceId: deviceId.trim(), pairingCode: pairingCode.trim() },
      false,
    );
    await this.options.credentialStore.saveCredential({
      credential: result.credential,
      deviceName: result.device.name,
    });
    return result.device;
  }

  catalog() {
    return this.request('/catalog', catalogSchema, {}, false);
  }

  capabilities(): Promise<Capability[]> {
    return this.request('/capabilities', capabilitiesResponseSchema, {}, false).then(
      (result) => result.capabilities,
    );
  }

  orders(status?: OrderStatus) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/operator/orders${query}`, ordersResponseSchema).then(
      (result) => result.orders,
    );
  }

  order(id: string) {
    return this.request(`/operator/orders/${id}`, orderResponseSchema).then(
      (result) => result.order,
    );
  }

  parseOrderDraft(rawMessage: string) {
    return this.post('/operator/order-drafts/parse', orderDraftSchema, { rawMessage });
  }

  createOrder(input: Omit<OrderCreateRequest, 'idempotencyKey'> & { idempotencyKey?: string }) {
    return this.post('/operator/orders', orderResponseSchema, {
      ...input,
      idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
    }).then((result) => result.order);
  }

  updateOrderStatus(id: string, status: OrderStatus, note = '') {
    return this.request(`/operator/orders/${id}/status`, orderResponseSchema, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, note }),
    }).then((result) => result.order);
  }

  issueSpinCode(id: string, idempotencyKey = createIdempotencyKey()) {
    return this.post(`/operator/orders/${id}/spin-code`, spinCodeIssueResponseSchema, {
      idempotencyKey,
    });
  }

  business(from: Date, to: Date): Promise<BusinessState> {
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    return this.request(`/operator/business?${params}`, businessStateResponseSchema);
  }

  addIngredient(input: { name: string; unit: 'g' | 'ml' | 'pz'; minimum: number }) {
    return this.post(
      '/operator/business/ingredients',
      z.object({ ingredient: z.unknown() }),
      input,
    );
  }

  saveRecipe(input: {
    productId: string;
    targetMargin: number;
    overheadCents: number;
    priceCents: number;
    lines: Array<{ ingredientId: string; quantity: number }>;
  }) {
    return this.post('/operator/business/recipes', z.object({ saved: z.literal(true) }), input);
  }

  createRecipeVersion(input: RecipeVersionCreate) {
    return this.post('/operator/recipes/versions', recipeVersionMutationResponseSchema, input);
  }

  recipeVersions(productId?: string): Promise<RecipeVersionState> {
    const query = productId ? `?productId=${encodeURIComponent(productId)}` : '';
    return this.request(`/operator/recipes/versions${query}`, recipeVersionStateSchema);
  }

  createProductionBatch(input: ProductionBatchCreate) {
    return this.post('/operator/production/batches', productionBatchResponseSchema, input);
  }

  quoteUnifiedOrder(input: Omit<UnifiedOrderConfirm, 'idempotencyKey'>) {
    return this.post('/operator/unified-orders/quote', unifiedOrderQuoteResponseSchema, input);
  }

  recordBusinessEntry(input: Record<string, unknown>) {
    return this.post(
      '/operator/business/entries',
      z.object({ entry: z.unknown(), reused: z.boolean() }),
      input,
    );
  }

  stockLedger(limit = 100, cursor?: string) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return this.request(`/operator/inventory/ledger?${query}`, stockLedgerStateSchema);
  }

  reserveStock(input: StockReservationRequest) {
    return this.post('/operator/inventory/reservations', stockReservationResponseSchema, input);
  }

  releaseStockReservation(reservationId: string, input: StockReservationResolveRequest) {
    return this.post(
      `/operator/inventory/reservations/${reservationId}/release`,
      stockReservationReleaseResponseSchema,
      input,
    );
  }

  countStock(input: StockCountRequest) {
    return this.post('/operator/inventory/counts', stockMutationResponseSchema, input);
  }

  writeOffStock(input: StockWasteRequest) {
    return this.post('/operator/inventory/write-offs', stockMutationResponseSchema, input);
  }

  createPurchase(input: PurchaseCreate) {
    return this.post(
      '/operator/purchasing/purchases',
      z.object({
        purchaseId: z.string().uuid(),
        totalCents: z.number().int(),
        lines: z.array(z.unknown()),
        reused: z.boolean(),
      }),
      input,
    );
  }

  reversePurchase(purchaseId: string, input: { idempotencyKey: string; reason: string }) {
    return this.post(
      `/operator/purchasing/purchases/${purchaseId}/reverse`,
      z.object({
        purchaseId: z.string().uuid(),
        reversalId: z.string().uuid(),
        status: z.literal('reversed'),
        reused: z.boolean(),
      }),
      input,
    );
  }

  /** Reads an authenticated SSE stream until it closes or is aborted. */
  async subscribeOrderEvents(onOrder: (orderId: string) => void, signal: AbortSignal) {
    const response = await this.requestFetch(`${this.baseUrl}/operator/orders/stream`, {
      headers: await this.headers(),
      signal,
    });
    if (!response.ok) {
      if (response.status === 401) await this.options.credentialStore.clearCredential();
      throw new BjApiError('No se pudo conectar a actualizaciones.', response.status);
    }
    if (!response.body)
      throw new BjApiError('Este dispositivo no admite actualizaciones en tiempo real.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          const type = event.match(/^event:\s*(.+)$/m)?.[1];
          const data = event.match(/^data:\s*(.+)$/m)?.[1];
          if (type !== 'order' || !data) continue;
          let rawPayload: unknown;
          try {
            rawPayload = JSON.parse(data);
          } catch {
            continue;
          }
          const payload = z.object({ orderId: z.string().uuid() }).safeParse(rawPayload);
          if (payload.success) onOrder(payload.data.orderId);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export type { BusinessState, Order, OrderDraft };

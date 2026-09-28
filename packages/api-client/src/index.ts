import {
  businessStateResponseSchema,
  capabilitiesResponseSchema,
  catalogSchema,
  cashSessionCloseResponseSchema,
  counterCheckoutResponseSchema,
  expenseCreateResponseSchema,
  operatorDeviceActivationResponseSchema,
  orderDraftSchema,
  orderResponseSchema,
  orderPaymentResultSchema,
  orderRefundResponseSchema,
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
  cashSessionStateSchema,
  type CashMovement,
  type CashSessionClose,
  type CashSessionOpen,
  type CashSessionState,
  type OrderPaymentCreate,
  type OrderRefundCreate,
  orderTicketResponseSchema,
  purchaseCreateResponseSchema,
  purchaseReversalResponseSchema,
  type TicketIssue,
  type ExpenseCreate,
  profitabilityReportSchema,
  type ProfitabilityReport,
} from '@bj/contracts';
import { z, type ZodType } from 'zod';

export interface CredentialStore {
  getCredential(): Promise<string | null>;
  saveCredential(input: { credential: string; deviceName: string }): Promise<void>;
  clearCredential(): Promise<void>;
}

export interface PendingOperationStore {
  prepare(input: { path: string; fingerprint: string; idempotencyKey: string }): Promise<string>;
  complete(path: string, idempotencyKey: string): Promise<void>;
}

export class BjApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
    public readonly metadata: {
      category?: BjApiErrorCategory | undefined;
      method?: string | undefined;
      path?: string | undefined;
      requestId?: string | undefined;
      retryAfterMs?: number | undefined;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'BjApiError';
  }

  get unauthorized() {
    return this.statusCode === 401;
  }

  get ambiguous() {
    return (
      this.metadata.category === 'timeout' ||
      this.metadata.category === 'network' ||
      this.metadata.category === 'invalid_response' ||
      this.statusCode === undefined ||
      this.statusCode >= 500
    );
  }

  get retryable() {
    return (
      this.metadata.category === 'network' ||
      this.metadata.category === 'timeout' ||
      this.statusCode === 408 ||
      this.statusCode === 429 ||
      (this.statusCode ?? 0) >= 500
    );
  }

  get category(): BjApiErrorCategory {
    return this.metadata.category ?? categoryForStatus(this.statusCode);
  }

  get requestId() {
    return this.metadata.requestId;
  }
}

export type BjApiErrorCategory =
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'server'
  | 'invalid_response'
  | 'http';

function categoryForStatus(status?: number): BjApiErrorCategory {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status && status >= 500) return 'server';
  return 'http';
}

export interface BjApiClientOptions {
  baseUrl: string;
  credentialStore: CredentialStore;
  fetch?: typeof fetch;
  timeoutMs?: number;
  pendingOperations?: PendingOperationStore;
}

type RequestInitWithTimeout = RequestInit & { timeoutMs?: number };

const errorBodySchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});

function trimBaseUrl(value: string) {
  return value.replace(/\/$/, '');
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
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
    let didTimeout = false;
    const abortFromCaller = () => controller.abort();
    if (init.signal?.aborted) abortFromCaller();
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, init.timeoutMs ?? this.timeoutMs);
    const method = init.method ?? 'GET';
    const pathOnly = path.split('?')[0]!;
    try {
      const headers = await this.headers(protectedRoute);
      const response = await this.requestFetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: controller.signal,
      });
      const requestId = response.headers.get('x-request-id') ?? undefined;
      let raw: unknown = {};
      if (response.status !== 204) {
        try {
          raw = await response.json();
        } catch (cause) {
          throw new BjApiError(
            `El servidor devolvió una respuesta ilegible.${requestId ? ` Referencia: ${requestId}.` : ''}`,
            response.status,
            cause,
            {
              category: 'invalid_response',
              method,
              path: pathOnly,
              requestId,
            },
          );
        }
      }
      if (!response.ok) {
        const body = errorBodySchema.safeParse(raw);
        if (response.status === 401) await this.options.credentialStore.clearCredential();
        throw new BjApiError(
          body.success && body.data.message
            ? `${body.data.message}${response.status >= 500 && (body.data.requestId ?? requestId) ? ` Referencia: ${body.data.requestId ?? requestId}.` : ''}`
            : 'No fue posible completar la operación.',
          response.status,
          undefined,
          {
            category: categoryForStatus(response.status),
            method,
            path: pathOnly,
            requestId: body.success ? (body.data.requestId ?? requestId) : requestId,
            retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
            details: body.success ? body.data.details : undefined,
          },
        );
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new BjApiError(
          `El servidor devolvió datos incompatibles con la app.${requestId ? ` Referencia: ${requestId}.` : ''}`,
          undefined,
          parsed.error,
          {
            category: 'invalid_response',
            method,
            path: pathOnly,
            requestId,
            details: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              code: issue.code,
            })),
          },
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof BjApiError) throw error;
      const timedOut = didTimeout;
      const cancelled =
        !timedOut &&
        (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError'));
      throw new BjApiError(
        timedOut
          ? 'La operación tardó demasiado.'
          : cancelled
            ? 'La operación fue cancelada.'
            : 'No hay conexión con el servidor.',
        undefined,
        error,
        {
          category: timedOut ? 'timeout' : cancelled ? 'cancelled' : 'network',
          method,
          path: pathOnly,
        },
      );
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private post<T>(
    path: string,
    schema: ZodType<T>,
    body: unknown,
    protectedRoute = true,
    method = 'POST',
  ) {
    return (async () => {
      const record =
        body && typeof body === 'object' && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : undefined;
      const idempotencyKey =
        typeof record?.idempotencyKey === 'string' ? record.idempotencyKey : undefined;
      const operationPath = path.split('?')[0]!;
      const fingerprint = record
        ? JSON.stringify(
            Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'idempotencyKey')),
          )
        : JSON.stringify(body);
      const key =
        idempotencyKey && this.options.pendingOperations
          ? await this.options.pendingOperations.prepare({
              path: operationPath,
              fingerprint,
              idempotencyKey,
            })
          : idempotencyKey;
      const requestBody = key && record ? { ...record, idempotencyKey: key } : body;
      try {
        const result = await this.request(
          path,
          schema,
          {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody),
          },
          protectedRoute,
        );
        if (key) await this.options.pendingOperations?.complete(operationPath, key);
        return result;
      } catch (error) {
        if (key && error instanceof BjApiError && !error.ambiguous)
          await this.options.pendingOperations?.complete(operationPath, key);
        throw error;
      }
    })();
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

  updateOrderStatus(id: string, status: OrderStatus, note = '', idempotencyKey?: string) {
    return this.post(
      `/operator/orders/${id}/status`,
      orderResponseSchema,
      { status, note, idempotencyKey: idempotencyKey ?? createIdempotencyKey() },
      true,
      'PATCH',
    ).then((result) => result.order);
  }

  collectOrderPayment(id: string, input: OrderPaymentCreate) {
    return this.post('/operator/orders/' + id + '/payments', orderPaymentResultSchema, input);
  }

  checkoutCounterOrder(id: string, input: OrderPaymentCreate) {
    return this.post(
      `/operator/orders/${id}/counter-checkout`,
      counterCheckoutResponseSchema,
      input,
    );
  }

  refundOrderPayment(id: string, input: OrderRefundCreate) {
    return this.post('/operator/orders/' + id + '/refunds', orderRefundResponseSchema, input);
  }

  issueOrderTicket(id: string, input: TicketIssue) {
    return this.post(`/operator/orders/${id}/ticket`, orderTicketResponseSchema, input);
  }

  createExpense(input: ExpenseCreate) {
    return this.post('/operator/expenses', expenseCreateResponseSchema, input);
  }

  profitabilityReport(from: string, to: string, page = 1): Promise<ProfitabilityReport> {
    const params = new URLSearchParams({ from, to, page: String(page), pageSize: '50' });
    return this.request(`/operator/reports/profitability?${params}`, profitabilityReportSchema);
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

  addIngredient(input: {
    name: string;
    unit: 'g' | 'ml' | 'pz';
    minimum: number;
    idempotencyKey?: string;
  }) {
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
    idempotencyKey?: string;
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

  quoteUnifiedOrder(input: Omit<UnifiedOrderConfirm, 'idempotencyKey' | 'quotedTotalCents'>) {
    return this.post('/operator/unified-orders/quote', unifiedOrderQuoteResponseSchema, input);
  }

  confirmUnifiedOrder(input: UnifiedOrderConfirm) {
    return this.post('/operator/unified-orders', orderResponseSchema, input).then(
      (result) => result.order,
    );
  }

  cashSession(): Promise<CashSessionState> {
    return this.request('/operator/cash-session', cashSessionStateSchema);
  }

  openCashSession(input: CashSessionOpen) {
    return this.post('/operator/cash-session/open', cashSessionStateSchema, input);
  }

  recordCashMovement(input: CashMovement) {
    return this.post('/operator/cash-session/movements', cashSessionStateSchema, input);
  }

  closeCashSession(input: CashSessionClose) {
    return this.post('/operator/cash-session/close', cashSessionCloseResponseSchema, input);
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
    return this.post('/operator/purchasing/purchases', purchaseCreateResponseSchema, input);
  }

  reversePurchase(purchaseId: string, input: { idempotencyKey: string; reason: string }) {
    return this.post(
      `/operator/purchasing/purchases/${purchaseId}/reverse`,
      purchaseReversalResponseSchema,
      input,
    );
  }

  /** Reads an authenticated SSE stream until it closes or is aborted. */
  async subscribeOrderEvents(
    onOrder: (orderId: string) => void,
    signal: AbortSignal,
    onConnected?: () => void,
  ) {
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
          if (type === 'connected') {
            onConnected?.();
            continue;
          }
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

import { describe, expect, it, vi } from 'vitest';
import { BjApiClient, BjApiError, createIdempotencyKey, type CredentialStore } from './index.js';

const store: CredentialStore = {
  getCredential: vi.fn(async () => 'credential'),
  saveCredential: vi.fn(async () => undefined),
  clearCredential: vi.fn(async () => undefined),
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('BjApiClient', () => {
  it('preserves an explicit idempotency key when creating an order', async () => {
    const request = vi.fn(async (...requestArguments: Parameters<typeof globalThis.fetch>) => {
      void requestArguments;
      return json({
        order: {
          id: '4efbd774-a99b-43a0-a7c7-34d43c1cd800',
          source: 'manual',
          fulfillment: 'delivery',
          status: 'new',
          customerName: 'Ana',
          neighborhood: '',
          streetAndNumber: '',
          references: '',
          deliveryNotes: '',
          rawMessage: '',
          promotion: null,
          subtotalCents: 100,
          deliveryCents: 0,
          totalCents: 100,
          manualDiscountCents: 0,
          manualDiscountReason: '',
          paidCents: 0,
          refundedCents: 0,
          balanceCents: 100,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          quotedAt: null,
          preparingAt: null,
          deliveredAt: null,
          cancelledAt: null,
          spinCodeIssued: false,
          payments: [],
          items: [],
          events: [],
        },
      });
    });
    const client = new BjApiClient({
      baseUrl: 'https://api.example/api/v1/',
      credentialStore: store,
      fetch: request as typeof globalThis.fetch,
    });
    await client.createOrder({
      rawMessage: '',
      customerName: 'Ana',
      neighborhood: '',
      streetAndNumber: '',
      references: '',
      deliveryNotes: '',
      items: [],
      idempotencyKey: 'f3c2c271-cb91-4bb1-9f37-d85647840951',
    } as never);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).idempotencyKey).toBe(
      'f3c2c271-cb91-4bb1-9f37-d85647840951',
    );
    expect(request.mock.calls[0]?.[0]).toBe('https://api.example/api/v1/operator/orders');
  });

  it('clears a revoked device credential and exposes the server message', async () => {
    const client = new BjApiClient({
      baseUrl: 'https://api.example/api/v1',
      credentialStore: store,
      fetch: (async () => json({ message: 'Revocado' }, 401)) as typeof globalThis.fetch,
    });
    await expect(client.orders()).rejects.toMatchObject({
      message: 'Revocado',
      statusCode: 401,
    } satisfies Partial<BjApiError>);
    expect(store.clearCredential).toHaveBeenCalled();
  });

  it('uses RFC 4122 v4-shaped keys for retriable writes', () => {
    expect(createIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('uses the server capability list before exposing a staged POS circuit', async () => {
    const client = new BjApiClient({
      baseUrl: 'https://api.example/api/v1',
      credentialStore: store,
      fetch: (async () =>
        json({
          capabilities: [
            { key: 'unified_orders', enabled: false, updatedAt: '2026-09-19T00:00:00.000Z' },
          ],
        })) as typeof globalThis.fetch,
    });
    await expect(client.capabilities()).resolves.toEqual([
      { key: 'unified_orders', enabled: false, updatedAt: '2026-09-19T00:00:00.000Z' },
    ]);
  });

  it('refetches live data after the SSE connection is restored', async () => {
    const bytes = new TextEncoder().encode(
      'event: connected\ndata: {"device":"Tablet cocina"}\n\nevent: order\ndata: {"orderId":"4efbd774-a99b-43a0-a7c7-34d43c1cd800"}\n\n',
    );
    const client = new BjApiClient({
      baseUrl: 'https://api.example/api/v1',
      credentialStore: store,
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )) as typeof globalThis.fetch,
    });
    const onOrder = vi.fn();
    const onConnected = vi.fn();
    await client.subscribeOrderEvents(onOrder, new AbortController().signal, onConnected);
    expect(onConnected).toHaveBeenCalledOnce();
    expect(onOrder).toHaveBeenCalledWith('4efbd774-a99b-43a0-a7c7-34d43c1cd800');
  });
});

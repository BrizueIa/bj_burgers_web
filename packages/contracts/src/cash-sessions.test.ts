import { describe, expect, it } from 'vitest';
import { cashSessionStateSchema } from './cash-sessions.js';

describe('estado de caja', () => {
  it('permite consultar servidores anteriores sin historial de cierres', () => {
    expect(cashSessionStateSchema.parse({ session: null, movements: [] })).toEqual({
      session: null,
      movements: [],
      lastClosedSession: null,
      recentClosings: [],
    });
  });
});

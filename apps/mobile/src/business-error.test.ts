import { describe, expect, it } from 'vitest';
import { BjApiError } from '@bj/api-client';
import { businessLoadErrorMessage } from './business-error';

describe('businessLoadErrorMessage', () => {
  it('explains that a missing business route requires an API update', () => {
    expect(
      businessLoadErrorMessage(
        new BjApiError('Route GET:/api/v1/operator/business not found', 404),
        'fallback',
      ),
    ).toBe(
      'La API conectada todavía no incluye el POS. Actualiza el servidor y vuelve a intentar.',
    );
  });

  it('preserves useful API errors and falls back for unknown failures', () => {
    expect(
      businessLoadErrorMessage(new BjApiError('Dispositivo no autorizado.', 401), 'fallback'),
    ).toBe('Dispositivo no autorizado.');
    expect(businessLoadErrorMessage(new Error('network'), 'fallback')).toBe('fallback');
  });
});

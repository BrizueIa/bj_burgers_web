import { BjApiError } from '@bj/api-client';

export function businessLoadErrorMessage(error: unknown, fallback: string) {
  if (error instanceof BjApiError && error.statusCode === 404)
    return 'La API conectada todavía no incluye el POS. Actualiza el servidor y vuelve a intentar.';
  return error instanceof BjApiError ? error.message : fallback;
}

import { ZodError, type ZodType } from 'zod';

export class ApiResponseError extends Error {
  constructor(readonly details: Array<{ path: string; code: string }>) {
    super('La API generó una respuesta incompatible con el contrato.');
    this.name = 'ApiResponseError';
  }
}

/** Validate server output at the boundary and retain only safe issue metadata. */
export function apiResponse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const error: ZodError = parsed.error;
    throw new ApiResponseError(
      error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    );
  }
  return parsed.data;
}

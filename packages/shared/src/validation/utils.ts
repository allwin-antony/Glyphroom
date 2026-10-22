import { ZodError, ZodSchema } from 'zod';

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  error: ZodError;
  formattedError: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Safely parses data against a Zod schema returning structured result without throwing.
 */
export function safeValidate<T>(schema: ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const formatted = result.error.issues
    .map((issue) => `[${issue.path.join('.')}]: ${issue.message}`)
    .join('; ');
  return {
    success: false,
    error: result.error,
    formattedError: formatted,
  };
}

/**
 * Asserts schema validation, throwing descriptive error on failure.
 */
export function validateOrThrow<T>(schema: ZodSchema<T>, data: unknown, contextName = 'Validation'): T {
  const result = safeValidate(schema, data);
  if (!result.success) {
    throw new Error(`${contextName} failed: ${result.formattedError}`);
  }
  return result.data;
}

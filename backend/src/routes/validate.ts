import type { z } from 'zod';
import { badRequest } from '../utils/errors.js';

/** Parses with Zod or throws a 400 carrying the exact field-level issues. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('VALIDATION_ERROR', `Invalid ${what}`, {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

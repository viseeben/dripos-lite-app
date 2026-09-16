/** Every error the API returns travels as `{ error, code, ...extra }`. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }

  toBody(): Record<string, unknown> {
    return { error: this.message, code: this.code, ...this.extra };
  }
}

export const badRequest = (code: string, message: string, extra?: Record<string, unknown>) =>
  new HttpError(400, code, message, extra);

export const notFound = (code: string, message: string, extra?: Record<string, unknown>) =>
  new HttpError(404, code, message, extra);

export const conflict = (code: string, message: string, extra?: Record<string, unknown>) =>
  new HttpError(409, code, message, extra);

export const unprocessable = (code: string, message: string, extra?: Record<string, unknown>) =>
  new HttpError(422, code, message, extra);

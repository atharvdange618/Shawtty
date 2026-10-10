export type ApiErrorOptions = {
  status?: number;
  detail?: Record<string, unknown>;
};

/** Error carrying the upstream HTTP status + request context for logging. */
export class ApiError extends Error {
  status?: number;
  detail?: Record<string, unknown>;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.detail = options.detail;
  }
}

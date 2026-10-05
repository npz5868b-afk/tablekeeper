export class LifecycleError extends Error {
  constructor(code, message = code, { retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'LifecycleError';
    this.code = code;
    this.retryable = retryable;
  }
}

export const fail = (condition, code, message) => {
  if (!condition) throw new LifecycleError(code, message);
};

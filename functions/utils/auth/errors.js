export class AuthCoordinatorError extends Error {
  constructor(code, status = 503, cause) {
    super(code, { cause });
    this.name = 'AuthCoordinatorError';
    this.code = code;
    this.status = status;
  }
}

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const AUTH_SCHEMA_VERSION = 1;

function failure(code = 'INVALID_CREDENTIALS') {
  return Object.freeze({ ok: false, code });
}

export class AuthService {
  constructor(dependencies) {
    this.repository = dependencies.repository;
    this.passwords = dependencies.passwords;
    this.tokens = dependencies.tokens;
    this.clock = dependencies.clock;
    this.bootstrapCredentials = dependencies.bootstrapCredentials;
  }

  bootstrapLogin(input) {
    return this.repository.transaction(async () => {
      const state = this.repository.readAuthState();
      if (state) return this.loginInitialized(input, state);
      return this.initialize(input);
    });
  }

  async initialize(input) {
    if (!await this.bootstrapCredentials.verify(input)) return failure();
    const credentials = await this.passwords.createRecord({
      ...input,
      credVersion: 1,
    });
    const state = Object.freeze({ initialized: true, ...credentials });
    this.repository.initializeAuth(state);
    return this.successWithSession(state);
  }

  async loginInitialized(input, state) {
    if (input.username !== state.username) return failure();
    if (!await this.passwords.verify(input, state)) return failure();
    return this.successWithSession(state);
  }

  successWithSession(state) {
    const session = this.issueSession(state);
    return Object.freeze({ ok: true, session, credVersion: state.credVersion });
  }

  issueSession(state) {
    const createdAt = this.clock.now();
    const session = Object.freeze({
      token: this.tokens.create(),
      username: state.username,
      credVersion: state.credVersion,
      createdAt,
      expiresAt: createdAt + SESSION_DURATION_MS,
    });
    this.repository.writeSession(session);
    return session;
  }

  verifySession(input) {
    return this.repository.transaction(() => this.verifySessionRecord(input.token));
  }

  verifySessionRecord(token) {
    const session = this.repository.readSession(token);
    const state = this.repository.readAuthState();
    if (!session || !state) return false;
    if (this.clock.now() > session.expiresAt) {
      this.repository.deleteSession(token);
      return false;
    }
    return session.credVersion === state.credVersion;
  }

  changeCredentials(input) {
    return this.repository.transaction(async () => {
      if (!this.verifySessionRecord(input.sessionToken)) return failure('SESSION_INVALID');
      const current = this.repository.readAuthState();
      const credentials = await this.passwords.createRecord({
        username: input.username,
        password: input.password,
        credVersion: current.credVersion + 1,
      });
      const next = Object.freeze({ initialized: true, ...credentials });
      this.repository.updateAuth(next);
      this.repository.deleteAllSessions();
      return this.successWithSession(next);
    });
  }

  logout(input) {
    return this.repository.transaction(() => {
      this.repository.deleteSession(input.token);
      return Object.freeze({ ok: true });
    });
  }

  status() {
    return Object.freeze({
      initialized: Boolean(this.repository.readAuthState()),
      schemaVersion: AUTH_SCHEMA_VERSION,
    });
  }
}

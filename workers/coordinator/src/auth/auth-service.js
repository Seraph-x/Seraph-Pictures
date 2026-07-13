const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const AUTH_SCHEMA_VERSION = 1;
const MIN_LEGACY_ITERATIONS = 100_000;
const PASSKEY_CHALLENGE_DURATION_MS = 5 * 60 * 1000;
const PASSKEY_CHALLENGE_KINDS = new Set(['register', 'auth']);
const PASSKEY_MIGRATION_KEY = 'passkeys_migrated';
const PASSKEY_CLEANUP_KEY = 'passkeys_cleanup';
const LEGACY_CLEANUP_KEY = 'legacy_credential_cleanup';

function failure(code = 'INVALID_CREDENTIALS') {
  return Object.freeze({ ok: false, code });
}

function isValidLegacyCredential(input) {
  return input.migrationAuthorized === true
    && typeof input.username === 'string'
    && typeof input.passwordHash === 'string'
    && typeof input.salt === 'string'
    && Number.isInteger(input.iterations)
    && input.iterations >= MIN_LEGACY_ITERATIONS
    && Number.isInteger(input.credVersion)
    && input.credVersion >= 1;
}

function isValidPasskey(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.publicKey === 'string'
    && value.publicKey.length > 0;
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

  migrateLegacyLogin(input) {
    return this.repository.transaction(async () => {
      const state = this.repository.readAuthState();
      if (state) return this.loginInitialized(input, state);
      if (!isValidLegacyCredential(input)) return failure('LEGACY_CREDENTIAL_INVALID');
      const next = Object.freeze({ initialized: true, ...input });
      this.repository.initializeAuth(next);
      this.repository.writeMetadata(LEGACY_CLEANUP_KEY, 'pending');
      return this.successWithSession(next);
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
    const session = this.createSessionRecord(state);
    return Object.freeze({ ok: true, session, credVersion: state.credVersion });
  }

  createSessionRecord(state) {
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

  verifyCredentials(input) {
    return this.repository.transaction(async () => {
      const state = this.repository.readAuthState();
      if (!state || input.username !== state.username) return failure();
      const ok = await this.passwords.verify(input, state);
      return Object.freeze({ ok, credVersion: ok ? state.credVersion : null });
    });
  }

  issueSession(input) {
    return this.repository.transaction(() => {
      const state = this.repository.readAuthState();
      if (!state || input.username !== state.username) return failure('PROFILE_MISMATCH');
      return this.successWithSession(state);
    });
  }

  readProfile() {
    const state = this.repository.readAuthState();
    if (!state) return Object.freeze({ initialized: false });
    return Object.freeze({
      initialized: true,
      username: state.username,
      credVersion: state.credVersion,
    });
  }

  getProfile(input) {
    return this.repository.transaction(() => {
      if (!this.verifySessionRecord(input.token)) return failure('SESSION_INVALID');
      const profile = this.readProfile();
      return Object.freeze({ ok: true, username: profile.username, credVersion: profile.credVersion });
    });
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
    const status = {
      initialized: Boolean(this.repository.readAuthState()),
      schemaVersion: AUTH_SCHEMA_VERSION,
    };
    if (this.repository.readMetadata(LEGACY_CLEANUP_KEY) === 'pending') {
      status.legacyCleanupRequired = true;
    }
    return Object.freeze(status);
  }

  completeLegacyCredentialCleanup() {
    this.repository.writeMetadata(LEGACY_CLEANUP_KEY, 'complete');
    return Object.freeze({ ok: true });
  }

  listPasskeys() {
    return Object.freeze({ items: this.repository.listPasskeys() });
  }

  savePasskey(input) {
    if (!isValidPasskey(input.credential)) return failure('PASSKEY_INVALID');
    this.repository.writePasskey(Object.freeze({ ...input.credential }));
    return Object.freeze({ ok: true });
  }

  putPasskeyChallenge(input) {
    if (!PASSKEY_CHALLENGE_KINDS.has(input.kind) || typeof input.challenge !== 'string') {
      return failure('PASSKEY_CHALLENGE_INVALID');
    }
    this.repository.writeChallenge(Object.freeze({
      kind: input.kind,
      challenge: input.challenge,
      expiresAt: this.clock.now() + PASSKEY_CHALLENGE_DURATION_MS,
    }));
    return Object.freeze({ ok: true });
  }

  takePasskeyChallenge(input) {
    return this.repository.transaction(() => {
      const record = this.repository.takeChallenge(input.kind);
      const challenge = record && record.expiresAt > this.clock.now() ? record.challenge : null;
      return Object.freeze({ challenge });
    });
  }

  updatePasskeyCounter(input) {
    return this.repository.transaction(() => {
      const current = this.repository.readPasskey(input.id);
      if (!current) return failure('PASSKEY_NOT_FOUND');
      if (!Number.isInteger(input.counter) || input.counter < Number(current.counter || 0)) {
        return failure('PASSKEY_COUNTER_INVALID');
      }
      this.repository.writePasskey(Object.freeze({
        ...current, counter: input.counter, lastUsedAt: input.lastUsedAt,
      }));
      return Object.freeze({ ok: true });
    });
  }

  renamePasskey(input) {
    const current = this.repository.readPasskey(input.id);
    if (!current) return failure('PASSKEY_NOT_FOUND');
    this.repository.writePasskey(Object.freeze({ ...current, name: input.name }));
    return Object.freeze({ ok: true });
  }

  deletePasskey(input) {
    return this.repository.deletePasskey(input.id)
      ? Object.freeze({ ok: true })
      : failure('PASSKEY_NOT_FOUND');
  }

  passkeyMigrationStatus() {
    const status = {
      migrated: this.repository.readMetadata(PASSKEY_MIGRATION_KEY) === 'true',
    };
    if (this.repository.readMetadata(PASSKEY_CLEANUP_KEY) === 'pending') {
      status.cleanupRequired = true;
    }
    return Object.freeze(status);
  }

  migrateLegacyPasskeys(input) {
    return this.repository.transaction(() => {
      if (this.passkeyMigrationStatus().migrated) {
        return Object.freeze({ ok: true, items: this.repository.listPasskeys() });
      }
      if (input.migrationAuthorized !== true || !Array.isArray(input.items)) {
        return failure('PASSKEY_MIGRATION_INVALID');
      }
      if (!input.items.every(isValidPasskey)) return failure('PASSKEY_MIGRATION_INVALID');
      for (const credential of input.items) this.repository.writePasskey(Object.freeze({ ...credential }));
      this.repository.writeMetadata(PASSKEY_MIGRATION_KEY, 'true');
      this.repository.writeMetadata(PASSKEY_CLEANUP_KEY, 'pending');
      return Object.freeze({ ok: true, items: this.repository.listPasskeys() });
    });
  }

  completeLegacyPasskeyCleanup() {
    this.repository.writeMetadata(PASSKEY_CLEANUP_KEY, 'complete');
    return Object.freeze({ ok: true });
  }
}

const PENDING_TIMEOUT_MS = 5 * 60 * 1_000;

function configError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function emptyState() {
  return Object.freeze({
    committedVersion: 0,
    committedDigest: null,
    pendingVersion: null,
    pendingDigest: null,
    pendingStartedAt: null,
  });
}

function authorityFrom(state) {
  const initialized = state.committedVersion > 0;
  return Object.freeze({
    initialized,
    committedVersion: initialized ? state.committedVersion : null,
    digest: initialized ? state.committedDigest : null,
  });
}

function clearPending(state) {
  return Object.freeze({
    ...state,
    pendingVersion: null,
    pendingDigest: null,
    pendingStartedAt: null,
  });
}

export class ConfigStateService {
  constructor({ repository, clock, alarms = null }) {
    this.repository = repository;
    this.clock = clock;
    this.alarms = alarms;
  }

  async readAuthority() {
    return authorityFrom(this.repository.readState() || emptyState());
  }

  async begin({ digest, expectedVersion, expectedDigest }) {
    if (typeof digest !== 'string' || !digest) throw configError('CONFIG_DIGEST_INVALID');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw configError('CONFIG_EXPECTATION_INVALID');
    }
    const result = await this.repository.transaction(() => this.beginTransaction({
      digest,
      expectedVersion,
      expectedDigest,
    }));
    if (!result.ok || !this.alarms) return result;
    try {
      await this.alarms.schedule(this.clock.now() + PENDING_TIMEOUT_MS);
      return result;
    } catch (error) {
      await this.abort({ version: result.version, digest });
      throw error;
    }
  }

  beginTransaction({ digest, expectedVersion, expectedDigest }) {
    const state = this.repository.readState() || emptyState();
    if (state.pendingVersion !== null) {
      return Object.freeze({ ok: false, code: 'CONFIG_WRITE_IN_PROGRESS' });
    }
    if (state.committedVersion !== expectedVersion || state.committedDigest !== expectedDigest) {
      return Object.freeze({ ok: false, code: 'CONFIG_VERSION_CONFLICT' });
    }
    const pendingVersion = state.committedVersion + 1;
    this.repository.writeState(Object.freeze({
      ...state,
      pendingVersion,
      pendingDigest: digest,
      pendingStartedAt: this.clock.now(),
    }));
    return Object.freeze({ ok: true, version: pendingVersion });
  }

  async commit({ version, digest }) {
    return this.repository.transaction(() => this.commitTransaction({ version, digest }));
  }

  commitTransaction({ version, digest }) {
    const state = this.repository.readState() || emptyState();
    if (state.committedVersion === version && state.committedDigest === digest) {
      return Object.freeze({ ok: true, committedVersion: version });
    }
    if (state.pendingVersion !== version || state.pendingDigest !== digest) {
      throw configError('CONFIG_COMMIT_MISMATCH');
    }
    this.repository.writeState(Object.freeze({
      ...clearPending(state),
      committedVersion: version,
      committedDigest: digest,
    }));
    return Object.freeze({ ok: true, committedVersion: version });
  }

  async abort({ version, digest }) {
    return this.repository.transaction(() => {
      const state = this.repository.readState() || emptyState();
      if (state.pendingVersion !== version || state.pendingDigest !== digest) {
        return Object.freeze({ aborted: false });
      }
      this.repository.writeState(clearPending(state));
      return Object.freeze({ aborted: true });
    });
  }

  async abortStale() {
    return this.repository.transaction(() => {
      const state = this.repository.readState() || emptyState();
      const deadline = (state.pendingStartedAt || 0) + PENDING_TIMEOUT_MS;
      if (state.pendingVersion === null || this.clock.now() < deadline) {
        return Object.freeze({ aborted: false });
      }
      this.repository.writeState(clearPending(state));
      return Object.freeze({ aborted: true });
    });
  }
}

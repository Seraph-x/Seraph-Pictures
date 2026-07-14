export class UploadQuotaAuthority {
  constructor(repository) { this.repository = repository; }

  async reserve(input) { return this.repository.reserveQuota(input); }

  async consume(input) { return this.repository.transitionQuota(input, 'consumed'); }

  async cancel(input) { return this.repository.transitionQuota(input, 'cancelled'); }
}

export class KvMetadataPublisher {
  constructor(namespace) { this.namespace = namespace; }

  async publish(input) {
    if (!this.namespace) throw new Error('MULTIPART_METADATA_BINDING_MISSING');
    const metadata = Object.freeze({
      ...input.metadata,
      uploadOperationId: input.operationId,
    });
    await this.namespace.put(input.key, input.value, { metadata });
  }
}

export class StorageReferenceAuthority {
  constructor(namespace) { this.namespace = namespace; }

  async invoke(operation, payload) {
    if (!this.namespace) throw new Error('MULTIPART_REFERENCE_BINDING_MISSING');
    const stub = this.namespace.get(this.namespace.idFromName('admin-auth'));
    const response = await stub.fetch(`https://coordinator.internal/auth/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data) {
      throw Object.assign(new Error(body?.error?.code || 'MULTIPART_REFERENCE_UNAVAILABLE'), {
        code: body?.error?.code || 'MULTIPART_REFERENCE_UNAVAILABLE',
      });
    }
    return body.data;
  }

  reserve(payload) { return this.invoke('storageRefReserve', payload); }
  commitStart(payload) { return this.invoke('storageRefCommitStart', payload); }
  commitFinish(payload) { return this.invoke('storageRefCommitFinish', payload); }
  releaseStart(payload) { return this.invoke('storageRefReleaseStart', payload); }
  releaseFinish(payload) { return this.invoke('storageRefReleaseFinish', payload); }
}

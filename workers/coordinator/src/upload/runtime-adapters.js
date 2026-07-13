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

import { UploadCoordinatorService } from './upload-coordinator.js';
import { UploadRepository } from './repository.js';
import {
  KvMetadataPublisher, StorageReferenceAuthority, UploadQuotaAuthority,
} from './runtime-adapters.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errorStatus(error) {
  if (error.code === 'MULTIPART_UPLOAD_NOT_FOUND') return 404;
  if (error.code?.includes('BINDING')) return 503;
  if (error.code?.startsWith('MULTIPART_')) return 409;
  return 500;
}

async function readJson(request) {
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('MULTIPART_PAYLOAD_INVALID');
  return body;
}

async function routeRequest(service, request) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname.endsWith('/initialize')) {
    return service.initialize(await readJson(request));
  }
  if (request.method === 'PUT' && url.pathname.endsWith('/part')) {
    return service.uploadPart({
      uploadId: url.searchParams.get('uploadId'),
      partNumber: Number(url.searchParams.get('partNumber')),
      digest: request.headers.get('X-Part-SHA256'),
      bytes: await request.arrayBuffer(),
    });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/complete')) {
    return service.complete(await readJson(request));
  }
  if (request.method === 'DELETE' && url.pathname.endsWith('/cancel')) {
    return service.cancel(await readJson(request));
  }
  throw Object.assign(new Error('MULTIPART_OPERATION_UNKNOWN'), { code: 'MULTIPART_OPERATION_UNKNOWN' });
}

export class UploadCoordinator {
  constructor(ctx, env) {
    const repository = new UploadRepository(ctx.storage);
    this.service = new UploadCoordinatorService({
      repository,
      r2: env.UPLOAD_BUCKET,
      quota: new UploadQuotaAuthority(repository),
      metadata: new KvMetadataPublisher(env.FILE_METADATA),
      references: new StorageReferenceAuthority(env.AUTH_COORDINATOR),
      alarms: { schedule: (timestamp) => ctx.storage.setAlarm(timestamp) },
    });
  }

  async fetch(request) {
    try {
      const data = await routeRequest(this.service, request);
      return json({ data });
    } catch (error) {
      return json({ error: { code: error.code || error.message } }, errorStatus(error));
    }
  }

  async alarm() {
    await this.service.cleanupExpired({ now: Date.now() });
  }
}

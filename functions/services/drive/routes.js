import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';
import contractModule from '../../../shared/storage/contracts.cjs';
import paginationModule from '../../../shared/storage/pagination.cjs';
import { createDriveRepository } from './repository.js';
import { deleteFileBatch, deleteFolder } from './deletion.js';
import { normalizeDrivePath } from './records.js';

const { driveEnvelope } = contractModule;
const { normalizePageRequest } = paginationModule;

function success(kind, payload) {
  return Response.json(driveEnvelope(kind, payload));
}

function errorResponse(error) {
  const authError = createAuthErrorResponse(error);
  if (authError) return authError;
  const code = error?.code || error?.message || 'DRIVE_OPERATION_FAILED';
  const status = error?.status || 500;
  if (status >= 500) console.error('Drive operation failed:', error);
  return Response.json({ success: false, error: { code } }, { status });
}

async function requireAdministrator(context) {
  if (!isAuthRequired(context.env)) return null;
  const auth = await checkAuthentication(context);
  return auth.authenticated
    ? null
    : Response.json({ success: false, error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
}

export function driveRoute(handler) {
  return async function protectedDriveRoute(context) {
    try {
      const unauthorized = await requireAdministrator(context);
      return unauthorized || await handler(context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

async function body(context) {
  try {
    const value = await context.request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value;
  } catch {
    throw Object.assign(new Error('REQUEST_BODY_INVALID'), { code: 'REQUEST_BODY_INVALID', status: 400 });
  }
}

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function explorerFilters(url) {
  const visibility = String(url.searchParams.get('visibility') || 'all').toLowerCase();
  if (!['all', 'public', 'private'].includes(visibility)) {
    throw Object.assign(new Error('FILE_VISIBILITY_INVALID'), { code: 'FILE_VISIBILITY_INVALID', status: 400 });
  }
  return Object.freeze({
    path: normalizeDrivePath(url.searchParams.get('path') || ''),
    storage: String(url.searchParams.get('storage') || 'all').toLowerCase(),
    search: String(url.searchParams.get('search') || '').trim().toLowerCase(),
    listType: String(url.searchParams.get('listType') || 'all').toLowerCase(),
    visibility,
  });
}

export async function listTree(context) {
  const url = new URL(context.request.url);
  const page = normalizePageRequest({
    limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor'),
  });
  const result = await createDriveRepository(context.env).listFolderPage(page);
  return Response.json({ ...driveEnvelope('nodes', result.nodes), nextCursor: result.nextCursor });
}

export async function listExplorer(context) {
  const url = new URL(context.request.url);
  const page = normalizePageRequest({
    limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor'),
  });
  const result = await createDriveRepository(context.env).listExplorerPage({
    ...page, filters: explorerFilters(url),
    includeStats: truthy(url.searchParams.get('includeStats')),
  });
  return success('explorer', result);
}

export async function createFolderRoute(context) {
  const input = await body(context);
  const folder = await createDriveRepository(context.env).createFolder(input.path);
  return success('folder', folder);
}

export async function moveFolderRoute(context) {
  const input = await body(context);
  const result = await createDriveRepository(context.env).moveFolder(input.sourcePath, input.targetPath);
  return success('mutation', result);
}

export async function deleteFolderRoute(context) {
  const url = new URL(context.request.url);
  const path = normalizeDrivePath(url.searchParams.get('path'));
  if (!path) throw Object.assign(new Error('DRIVE_PATH_REQUIRED'), { code: 'DRIVE_PATH_REQUIRED', status: 400 });
  const repository = createDriveRepository(context.env);
  return success('mutation', await deleteFolder(context, repository, path, truthy(url.searchParams.get('recursive'))));
}

export async function moveFilesRoute(context) {
  const input = await body(context);
  const result = await createDriveRepository(context.env).moveFiles(input.ids || [], input.targetFolderPath || '');
  return success('mutation', result);
}

export async function renameFileRoute(context) {
  const input = await body(context);
  const file = await createDriveRepository(context.env).renameFile(input.id, input.fileName);
  if (!file) throw Object.assign(new Error('FILE_NOT_FOUND'), { code: 'FILE_NOT_FOUND', status: 404 });
  return success('file', file);
}

export async function deleteFilesRoute(context) {
  const input = await body(context);
  const repository = createDriveRepository(context.env);
  return success('mutation', await deleteFileBatch(context, repository, input.ids));
}

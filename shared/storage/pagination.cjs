'use strict';

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1000;
const MAX_CURSOR_LENGTH = 4096;

class PaginationContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = 400;
  }
}

function normalizeLimit(value) {
  if (value == null || value === '') return DEFAULT_PAGE_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new PaginationContractError('PAGE_LIMIT_INVALID');
  }
  return limit;
}

function normalizeCursor(value) {
  if (value == null || value === '') return '';
  const cursor = String(value).trim();
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH || /[\u0000-\u001f\u007f]/.test(cursor)) {
    throw new PaginationContractError('PAGE_CURSOR_INVALID');
  }
  return cursor;
}

function normalizePageRequest(options = {}) {
  return Object.freeze({
    limit: normalizeLimit(options.limit),
    cursor: normalizeCursor(options.cursor),
  });
}

function normalizeNextCursor(value) {
  if (value == null || value === '') return null;
  return normalizeCursor(value);
}

module.exports = Object.freeze({
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PaginationContractError,
  normalizePageRequest,
  normalizeNextCursor,
});

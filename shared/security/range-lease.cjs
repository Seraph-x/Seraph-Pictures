const RANGE_HEADER_PATTERN = /^bytes=(\d+)-(\d*)$/i;
const CONTENT_RANGE_PATTERN = /^bytes (\d+)-(\d+)\/(\d+)$/i;

function parseRangeRequest(value) {
  if (!value) return Object.freeze({ present: false, valid: true, start: null });
  const match = String(value).trim().match(RANGE_HEADER_PATTERN);
  if (!match) return Object.freeze({ present: true, valid: false, start: null });
  return Object.freeze({
    present: true,
    valid: true,
    start: Number.parseInt(match[1], 10),
  });
}

function parseRangeResponse(value) {
  const match = String(value || '').trim().match(CONTENT_RANGE_PATTERN);
  if (!match) return null;
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  const total = Number.parseInt(match[3], 10);
  if (start > end || end >= total) return null;
  return Object.freeze({
    start,
    end,
    total,
    nextOffset: end + 1,
    complete: end + 1 >= total,
  });
}

module.exports = { parseRangeRequest, parseRangeResponse };

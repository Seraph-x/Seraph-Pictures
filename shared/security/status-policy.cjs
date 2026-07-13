const STATUS_ACTORS = Object.freeze({
  ADMIN: 'admin',
  ANONYMOUS: 'anonymous',
});

const MINIMAL_STATUS_BODY = Object.freeze({ status: 'ok' });
const ANONYMOUS_STATUS = Object.freeze({
  runProbes: false,
  body: MINIMAL_STATUS_BODY,
});
const ADMIN_STATUS = Object.freeze({
  runProbes: true,
  body: null,
});

function decideStatusAccess({ actor }) {
  return actor === STATUS_ACTORS.ADMIN ? ADMIN_STATUS : ANONYMOUS_STATUS;
}

module.exports = {
  STATUS_ACTORS,
  decideStatusAccess,
};

import sentryPlugin from "@cloudflare/pages-plugin-sentry";
import '@sentry/tracing';

const DEFAULT_TRACE_SAMPLE_RATE = 0.001;

export async function errorHandling(context) {
  context.data = context.data || {};
  if (!isTelemetryEnabled(context.env)) {
    context.data.telemetry = false;
    return context.next();
  }

  context.data.telemetry = true;
  return sentryPlugin({
    dsn: String(context.env.SENTRY_DSN).trim(),
    tracesSampleRate: parseSampleRate(context.env.sampleRate),
  })(context);
}

export async function telemetryData(context) {
  context.data = context.data || {};
  if (!context.data.telemetry || !context.data.sentry) {
    return context.next();
  }

  const requestInfo = buildRequestTelemetry(context.request);
  const sentry = context.data.sentry;
  sentry.setTag("method", requestInfo.method);
  sentry.setTag("path", requestInfo.path);
  sentry.setTag("host", requestInfo.host);

  const country = context.request.cf?.country;
  if (typeof country === "string" && country) {
    sentry.setTag("cf.country", country);
  }

  sentry.setContext("request", requestInfo);
  const transaction = sentry.startTransaction?.({
    name: `${requestInfo.method} ${requestInfo.host}`,
  });
  context.data.transaction = transaction || null;

  try {
    return await context.next();
  } finally {
    context.data.transaction?.finish?.();
  }
}

export async function traceData(context, span, op, name) {
  const data = context.data
  if (data.telemetry && data.transaction) {
    if (span) {
      span.finish();
    } else {
      span = await context.data.transaction.startChild(
        { op: op, name: name },
      );
    }
  }
}

function isTelemetryEnabled(env = {}) {
  return !isTruthy(env.disable_telemetry) && Boolean(String(env.SENTRY_DSN || "").trim());
}

function isTruthy(value) {
  if (value == null || value === "") return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseSampleRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return DEFAULT_TRACE_SAMPLE_RATE;
  }
  return numeric;
}

function buildRequestTelemetry(request) {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname,
    host: url.hostname,
  };
}

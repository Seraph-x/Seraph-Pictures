const { serve } = require('@hono/node-server');
const { createApp } = require('./app');

const app = createApp();
const port = Number(process.env.PORT || 8787);

if (['1', 'true', 'yes', 'on'].includes(String(process.env.AUTH_DISABLED || '').trim().toLowerCase())) {
  console.warn('[seraph-pictures] WARNING: authentication is explicitly disabled.');
}
console.log(`[seraph-pictures] Starting Docker runtime on :${port}`);

serve({ fetch: app.fetch, port });

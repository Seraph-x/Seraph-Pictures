import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = 4181;
const HOST = '127.0.0.1';
const ROOT = path.resolve('frontend/dist');
const MIME_TYPES = Object.freeze({
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
});

function resolveLegacyPath(pathname) {
  if (pathname === '/') return '/index.html';
  if (pathname.startsWith('/app/')) return pathname;
  if (path.extname(pathname)) return pathname;
  return `${pathname}.html`;
}

function resolveFile(pathname) {
  const relative = resolveLegacyPath(pathname);
  let candidate = path.resolve(ROOT, `.${relative}`);
  if (!candidate.startsWith(ROOT)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    candidate = path.join(candidate, 'index.html');
  }
  if (fs.existsSync(candidate)) return candidate;
  if (pathname.startsWith('/app/')) return path.join(ROOT, 'app/index.html');
  return null;
}

function sendFile(filePath, response) {
  const type = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${HOST}`).pathname;
  const filePath = resolveFile(decodeURIComponent(pathname));
  if (filePath) return sendFile(filePath, response);
  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('Not found');
});

server.listen(PORT, HOST, () => process.stdout.write(`baseline server ${HOST}:${PORT}\n`));

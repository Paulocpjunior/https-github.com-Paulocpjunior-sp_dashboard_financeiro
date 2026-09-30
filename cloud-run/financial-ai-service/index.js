import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createFinancialHandler } from './handler.js';
import { createOpenAIProvider } from './openai-provider.js';

const PROJECT = 'gen-lang-client-0888019226';
const MAX_BODY = 1024 * 1024;
function getServices() {
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: PROJECT });
  return { auth: getAuth(), db: getFirestore() };
}
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Payload excedido.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createServer(dependencies = {}) {
  const handler = createFinancialHandler({ getServices, readBody, sendJson, provider: createOpenAIProvider(), ...dependencies });
  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { ok: true, service: 'sp-financial-ai' });
    if (!await handler(request, response)) sendJson(response, 404, { error: 'Rota não encontrada.' });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) createServer().listen(Number(process.env.PORT) || 8080, '0.0.0.0');

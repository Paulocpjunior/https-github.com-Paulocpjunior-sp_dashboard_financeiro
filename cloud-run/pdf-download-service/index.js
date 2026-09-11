const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { getApps, initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const pendingPDFs = new Map();
const PDF_TTL_MS = 5 * 60 * 1000;
const BOLETO_SECRET_ENV = 'BOLETO_CLOUD_ACCOUNT_TOKEN';
const BOLETO_PERMISSION = 'billing.boleto-cloud.issue';
const BOLETO_HEADERS = [
  'TOKEN_CONTA_BANCARIA',
  'CPRF_PAGADOR',
  'VALOR',
  'VENCIMENTO',
  'NOSSO_NUMERO',
  'DOCUMENTO',
  'MULTA',
  'JUROS',
  'DIAS_PARA_ENCARGOS',
  'DESCONTO',
  'DIAS_PARA_DESCONTO',
  'TIPO_VALOR_DESCONTO',
  'DESCONTO2',
  'DIAS_PARA_DESCONTO2',
  'TIPO_VALOR_DESCONTO2',
  'DESCONTO3',
  'DIAS_PARA_DESCONTO3',
  'TIPO_VALOR_DESCONTO3',
  'INFORMACAO_PAGADOR',
];
const ALLOWED_ORIGINS = new Set([
  'https://gen-lang-client-0888019226.web.app',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

function corsHeaders(request) {
  const origin = String(request.headers.origin || '');
  return ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function sendText(request, response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request) });
  response.end(text);
}

function sendJson(request, response, status, value) {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...corsHeaders(request),
  });
  response.end(payload);
}

function getAdminServices() {
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  return { adminAuth: getAuth(), adminDb: getFirestore() };
}

async function authorizeBoletoRequest(request) {
  const authorization = String(request.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return false;
  const idToken = authorization.slice('Bearer '.length).trim();
  if (!idToken) return false;

  const { adminAuth, adminDb } = getAdminServices();
  const decoded = await adminAuth.verifyIdToken(idToken, true);
  const profile = await adminDb.collection('users').doc(decoded.uid).get();
  if (!profile.exists) return false;
  const data = profile.data() || {};
  if (data.active === false) return false;
  const role = String(data.role || '').toLowerCase().trim();
  const permissions = Array.isArray(data.financialPermissions) ? data.financialPermissions : [];
  return role === 'admin' || permissions.includes(BOLETO_PERMISSION);
}

function normalizeBoletoRows(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new Error('invalid boleto rows');
  }
  return value.map(row => {
    if (!Array.isArray(row) || row.length !== BOLETO_HEADERS.length - 1) {
      throw new Error('invalid boleto row');
    }
    return row.map(cell => {
      const text = String(cell ?? '');
      if (text.length > 500 || /[\r\n]/.test(text)) throw new Error('invalid boleto cell');
      return text;
    });
  });
}

async function readRequestBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function buildBoletoCsv(rows, accountToken) {
  const token = String(accountToken || '').trim();
  if (!token || /[;\r\n]/.test(token)) throw new Error('invalid boleto token');
  return '\uFEFF' + [
    BOLETO_HEADERS.join(';'),
    ...rows.map(row => [token, ...row].join(';')),
  ].join('\n');
}

function sanitizeFileName(value) {
  const name = String(value || 'base-faturamento.pdf').replace(/[^a-zA-Z0-9._-]/g, '-');
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

function createServer() {
  return http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...corsHeaders(request),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-PDF-Filename',
        'Access-Control-Max-Age': '86400',
      });
      response.end();
      return;
    }

    if (request.method === 'POST' && request.url === '/api/boleto-cloud-csv') {
      try {
        if (!(await authorizeBoletoRequest(request))) {
          sendJson(request, response, 403, { error: 'forbidden' });
          return;
        }
        const accountToken = process.env[BOLETO_SECRET_ENV];
        if (!accountToken) {
          sendJson(request, response, 503, { error: 'boleto secret unavailable' });
          return;
        }
        const body = JSON.parse((await readRequestBody(request)).toString('utf8'));
        const rows = normalizeBoletoRows(body.rows);
        const csv = buildBoletoCsv(rows, accountToken);
        const fileName = `boletos_importacao_${new Date().toISOString().slice(0, 10)}.csv`;
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': Buffer.byteLength(csv),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          ...corsHeaders(request),
        });
        response.end(csv);
      } catch (error) {
        const status = /token|credential|auth/i.test(String(error?.message || '')) ? 401 : 400;
        sendJson(request, response, status, { error: 'invalid boleto export request' });
      }
      return;
    }

    if (request.method === 'GET' && (request.url === '/health' || request.url === '/api/pdf-download/health')) {
      sendText(request, response, 200, 'ok');
      return;
    }

    const downloadMatch = request.url.match(/^\/api\/pdf-download\/([a-f0-9-]+)$/i);
    if (request.method === 'GET' && downloadMatch) {
      const entry = pendingPDFs.get(downloadMatch[1]);
      if (!entry || entry.expiresAt < Date.now()) {
        pendingPDFs.delete(downloadMatch[1]);
        sendText(request, response, 404, 'PDF expired');
        return;
      }

      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      let start = 0;
      let end = entry.pdf.length - 1;
      let status = 200;
      if (range) {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), end) : end;
        if (start > end || start >= entry.pdf.length) {
          response.writeHead(416, { 'Content-Range': `bytes */${entry.pdf.length}` });
          response.end();
          return;
        }
        status = 206;
      }

      const bytes = entry.pdf.subarray(start, end + 1);
      const headers = {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${entry.fileName}"`,
        'Content-Length': bytes.length,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${entry.pdf.length}`;
      response.writeHead(status, headers);
      response.end(bytes);
      return;
    }

    if (request.method !== 'POST' || request.url !== '/api/pdf-download') {
      sendText(request, response, 404, 'not found');
      return;
    }

    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const contentType = String(request.headers['content-type'] || '').toLowerCase();
        const requestBody = Buffer.concat(chunks);
        let pdf;
        let fileName;
        if (contentType.startsWith('application/pdf')) {
          pdf = requestBody;
          fileName = request.headers['x-pdf-filename'];
        } else {
          const body = new URLSearchParams(requestBody.toString('utf8'));
          pdf = Buffer.from(body.get('pdfBase64') || '', 'base64');
          fileName = body.get('fileName');
        }
        if (pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
          sendText(request, response, 400, 'invalid PDF');
          return;
        }

        const token = randomUUID();
        pendingPDFs.set(token, { pdf, fileName: sanitizeFileName(fileName), expiresAt: Date.now() + PDF_TTL_MS });
        const cleanup = setTimeout(() => pendingPDFs.delete(token), PDF_TTL_MS);
        cleanup.unref();
        const payload = JSON.stringify({ downloadUrl: `/api/pdf-download/${token}` });
        response.writeHead(201, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          'Cache-Control': 'no-store',
          ...corsHeaders(request),
        });
        response.end(payload);
      } catch {
        sendText(request, response, 400, 'invalid request');
      }
    });
  });
}

if (require.main === module) createServer().listen(Number(process.env.PORT) || 8080, '0.0.0.0');

module.exports = {
  BOLETO_HEADERS,
  buildBoletoCsv,
  createServer,
  normalizeBoletoRows,
  pendingPDFs,
  sanitizeFileName,
};

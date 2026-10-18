// Qual Gemini a FiA usa — perguntado ao Vertex, sem deploy para trocar.
// Paulo, 18/10/2026: "nenhum pode ficar desatualizado", com troca automática.
// A régua é a do CFI (gemini-modelo.mjs). A FiA usa a linha FLASH: resposta
// em JSON, curta, com limite de 45 s. O Pro de raciocínio (gemini-4-argon)
// não serve para esse tempo.
// Precedência: env FINANCIAL_AI_MODEL (pino humano) > lista do Vertex > ID
// conferido na doc da Google em 18/10 (gemini-3.8-flash). O Vertex não tem o
// alias -latest garantido, então a rede de baixo é um ID que existe.
const MODELO_CONFERIDO = 'gemini-3.8-flash';
const TTL_MS = 6 * 60 * 60 * 1000;
const TTL_FALHA_MS = 5 * 60 * 1000;
let estado = null;
let emCurso = null;

// Lista os modelos do publisher google (v1beta1). Aceita `publisherModels` e
// `models` porque o leiaute dessa listagem beta não foi conferido em produção;
// falha ou lista vazia cai no ID conferido e o status DIZ.
async function listarModelosVertex({ token, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  const modelos = [];
  let pageToken = '';
  for (let pagina = 0; pagina < 10; pagina += 1) {
    const url = 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=500'
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let body;
    try {
      const resp = await fetchImpl(url, { signal: ctrl.signal, headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`listagem de modelos: HTTP ${resp.status}`);
      body = await resp.json();
    } finally {
      clearTimeout(timer);
    }
    const lote = Array.isArray(body?.publisherModels) ? body.publisherModels : (Array.isArray(body?.models) ? body.models : []);
    // `publishers/google/models/gemini-3.8-flash` → `gemini-3.8-flash`.
    for (const m of lote) if (m?.name) modelos.push({ name: String(m.name).split('/').pop() });
    pageToken = body?.nextPageToken || '';
    if (!pageToken) break;
  }
  return modelos;
}

async function resolverMotor({ obterToken, fetchImpl, env = process.env, agora = Date.now() } = {}) {
  const pino = String(env.FINANCIAL_AI_MODEL || '').trim();
  if (pino) {
    estado = { modelo: pino, origem: 'env', motivo: 'Pinado à mão (FINANCIAL_AI_MODEL).', resolvidoEm: agora };
    return estado;
  }
  const { resolverModelosGemini } = await import('./gemini-modelo.mjs');
  let modelos = null;
  let erroDaLista = null;
  try {
    modelos = await listarModelosVertex({ token: await obterToken(), fetchImpl });
  } catch (e) {
    erroDaLista = e?.message || 'falha ao listar modelos';
  }
  const r = resolverModelosGemini({ modelos });
  const achou = r.flash.origem === 'familia-alvo';
  estado = achou
    ? { modelo: r.flash.modelo, origem: 'vertex', motivo: r.flash.motivo, resolvidoEm: agora }
    : { modelo: MODELO_CONFERIDO, origem: 'conferido', erroDaLista: erroDaLista || 'lista sem Flash reconhecível',
      motivo: `Não deu para escolher pela lista do Vertex — seguindo em ${MODELO_CONFERIDO}.`, resolvidoEm: agora };
  console.log(`[gemini] FiA=${estado.modelo} (${estado.origem})${estado.erroDaLista ? ` · ${estado.erroDaLista}` : ''}`);
  return estado;
}

async function modeloFiA(opts = {}) {
  const agora = opts.agora ?? Date.now();
  const venceu = !estado || agora - estado.resolvidoEm > (estado.erroDaLista ? TTL_FALHA_MS : TTL_MS);
  if (venceu) {
    emCurso = emCurso || resolverMotor({ ...opts, agora }).finally(() => { emCurso = null; });
    await emCurso;
  }
  return estado.modelo;
}

module.exports = {
  modeloFiA, estadoMotor: () => estado, MODELO_CONFERIDO, TTL_MS, TTL_FALHA_MS,
  _zerarMotorParaTeste: () => { estado = null; emCurso = null; },
};

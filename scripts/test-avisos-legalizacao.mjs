import assert from 'node:assert/strict';
import { createServer } from 'vite';

// 📣 Avisos da Legalização pelo túnel do CFI (26/10): pede só os do Financeiro
// e falha do túnel nunca vira alarme (null).
const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { buscarAvisosLegalizacao } = await server.ssrLoadModule('/services/cadastroCentralConferencia.ts');

  let url = '';
  const r = await buscarAvisosLegalizacao(async () => 'tok', {
    fetchImpl: async (u) => { url = u; return { ok: true, status: 200, json: async () => ({ ok: true, dias: 30, cortado: false, avisos: [{ id: 'a', tipo: 'servicos_alterados' }] }) }; },
  });
  assert.match(url, /\/api\/admin\/cadastro\/avisos-legalizacao\?destino=financeiro&dias=30$/);
  assert.deepEqual(r, { avisos: [{ id: 'a', tipo: 'servicos_alterados' }], cortado: false, dias: 30 });

  assert.equal(await buscarAvisosLegalizacao(async () => 'tok', { fetchImpl: async () => { throw new Error('CORS'); } }), null);
  assert.equal(await buscarAvisosLegalizacao(async () => 'tok', { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }) }), null);
  assert.equal(await buscarAvisosLegalizacao(async () => { throw new Error('sem sessão'); }), null);
  // 27/10: detalhe com "de → para" e serviços; aviso antigo não ganha linha.
  const { detalheAviso } = await server.ssrLoadModule('/services/cadastroCentralConferencia.ts');
  const base = { id: 'a', tipo: 'empresa_entrou', rotulo: 'Entrou', em: null, empresaNome: 'X', cnpj: null, porNome: null, campos: [], acao: null };
  assert.deepEqual(detalheAviso(base), []);
  assert.deepEqual(detalheAviso({ ...base, servicos: null }), []);
  assert.deepEqual(detalheAviso({ ...base, tributacao: '02 - SIMPLES', servicos: ['Contabilidade', 'Fiscal'] }), ['Tributação: 02 - SIMPLES', 'Serviços: Contabilidade, Fiscal']);
  assert.deepEqual(detalheAviso({ ...base, servicos: [] }), ['Nenhum serviço marcado no checklist']);
  assert.deepEqual(
    detalheAviso({ ...base, tipo: 'servicos_alterados', valores: [{ campo: 'servicosContratados', de: 'Fiscal', para: null }], servicosSairam: ['Fiscal'] }),
    ['serviços contratados: Fiscal → —', 'Saiu do contrato: Fiscal'],
  );
  console.log('avisos da Legalização: ok');
} finally {
  await server.close();
}

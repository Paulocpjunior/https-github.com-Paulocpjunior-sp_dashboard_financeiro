/**
 * services/cadastroCentralConferencia.ts — as cobranças do Financeiro
 * conferidas contra o cadastro central do CFI (08/08).
 *
 * Consulta transações salvas no Firestore, inclusive o histórico importado.
 * O nome pode ser texto livre e cpfCnpj é opcional. A conferência considera
 * somente transações com CNPJ preenchido e sinaliza os documentos que o
 * cadastro central do CFI não conhece. CPF (pessoa física) fica fora do escopo.
 * A equipe deve conferir o documento do lançamento e o cadastro central;
 * a divergência não determina automaticamente qual fonte está incorreta.
 */

const CFI_URL = 'https://consultor-fiscal-inteligente-zricstsjqa-uw.a.run.app';

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export interface EmpresaCentralMin { cnpj: string; nome: string | null }

export interface ConferenciaFinanceiro {
    /** transações com CNPJ que casou com o central */
    conferidas: number;
    /** CNPJs (com nomes usados e nº de transações) que o central não conhece */
    foraDoCadastro: Array<{ cnpj: string; nomes: string[]; transacoes: number }>;
    /** transações com CPF (PF) — fora do escopo, contadas para honestidade */
    pessoasFisicas: number;
    /** transações sem documento nenhum — o histórico Jotform é assim mesmo */
    semDocumento: number;
    totalCentral: number;
}

export function conferirTransacoes(
    transacoes: Array<{ cpfCnpj?: unknown; client?: unknown; isExcluded?: boolean }>,
    central: EmpresaCentralMin[],
): ConferenciaFinanceiro {
    const porCnpj = new Map<string, EmpresaCentralMin>();
    for (const e of central) {
        const c = soDigitos(e?.cnpj);
        if (c.length === 14) porCnpj.set(c, e);
    }

    const fora = new Map<string, { cnpj: string; nomes: Set<string>; transacoes: number }>();
    let conferidas = 0;
    let pessoasFisicas = 0;
    let semDocumento = 0;

    for (const t of transacoes) {
        if (t?.isExcluded) continue;
        const doc = soDigitos(t?.cpfCnpj);
        if (!doc) { semDocumento += 1; continue; }
        if (doc.length === 11) { pessoasFisicas += 1; continue; }
        if (doc.length !== 14) { semDocumento += 1; continue; }
        if (porCnpj.has(doc)) { conferidas += 1; continue; }
        if (!fora.has(doc)) fora.set(doc, { cnpj: doc, nomes: new Set(), transacoes: 0 });
        const f = fora.get(doc)!;
        const nome = String(t?.client ?? '').trim();
        if (nome) f.nomes.add(nome);
        f.transacoes += 1;
    }

    return {
        conferidas,
        foraDoCadastro: [...fora.values()]
            .map((f) => ({ cnpj: f.cnpj, nomes: [...f.nomes], transacoes: f.transacoes }))
            .sort((a, b) => b.transacoes - a.transacoes),
        pessoasFisicas,
        semDocumento,
        totalCentral: porCnpj.size,
    };
}

/**
 * Busca o cadastro central pelo túnel, direto do navegador (o CFI aceita o
 * token deste projeto e o CORS conhece estas origens). Nunca lança: falha
 * devolve null e a tela não mostra o bloco — lista vazia seria lida como
 * "nenhuma empresa no central", mentira.
 */
export async function buscarCadastroCentral(
    getToken: () => Promise<string>,
    deps: { fetchImpl?: typeof fetch } = {},
): Promise<EmpresaCentralMin[] | null> {
    const doFetch = deps.fetchImpl ?? fetch;
    try {
        const token = await getToken();
        const resp = await doFetch(`${CFI_URL}/api/admin/cadastro/empresas`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok || corpo?.ok !== true || !Array.isArray(corpo.empresas)) return null;
        return corpo.empresas.map((e: any) => ({ cnpj: e.cnpj, nome: e.nome ?? null }));
    } catch {
        return null;
    }
}

/**
 * 📣 Avisos da Legalização para o Financeiro (fase 4 do checklist, 26/10).
 * A Legalização é dona do cadastro geral: empresa que entrou, foi suspensa,
 * saiu ou foi baixada, dados gerais e serviços/honorários que mudaram viram
 * aviso. Vem pelo mesmo túnel do CFI. SÓ MOSTRA: nenhuma cobrança muda
 * sozinha, e o valor dos honorários nunca vem no aviso. Falha → null.
 */
export interface AvisoLegalizacao {
    id: string;
    tipo: string;
    rotulo: string;
    em: string | null;
    empresaNome: string | null;
    cnpj: string | null;
    porNome: string | null;
    campos: string[];
    /** "de → para" (desde 27/10; aviso antigo vem vazio). Honorários nunca têm valor. */
    valores?: Array<{ campo: string; de: string | null; para: string | null }>;
    tributacao?: string | null;
    /** Serviços contratados no momento do aviso; null = aviso antigo, sem a informação. */
    servicos?: string[] | null;
    servicosEntraram?: string[];
    servicosSairam?: string[];
    acao: string | null;
}

export const CAMPO_AVISO: Record<string, string> = {
    empresaNome: 'nome', documento: 'CNPJ', tributacao: 'tributação', statusCliente: 'status',
    servicosContratados: 'serviços contratados', honorarios: 'honorários', nossoNumero: 'nosso número', 'datas.alteracao': 'data de alteração',
};

/**
 * Detalhe do aviso para o Financeiro: "de → para", serviço que entrou/saiu e,
 * na entrada, a tributação e os serviços contratados. Aviso antigo (sem esses
 * campos) não ganha linha: ausente não vira "nenhum serviço".
 */
export function detalheAviso(a: AvisoLegalizacao): string[] {
    const out = (a.valores ?? []).map((v) => `${CAMPO_AVISO[v.campo] ?? v.campo}: ${v.de ?? '—'} → ${v.para ?? '—'}`);
    if (a.servicosEntraram?.length) out.push(`Entrou no contrato: ${a.servicosEntraram.join(', ')}`);
    if (a.servicosSairam?.length) out.push(`Saiu do contrato: ${a.servicosSairam.join(', ')}`);
    if (a.tipo === 'empresa_entrou') {
        if (a.tributacao) out.push(`Tributação: ${a.tributacao}`);
        if (Array.isArray(a.servicos)) out.push(a.servicos.length ? `Serviços: ${a.servicos.join(', ')}` : 'Nenhum serviço marcado no checklist');
    }
    return out;
}

export interface AvisosLegalizacao { avisos: AvisoLegalizacao[]; cortado: boolean; dias: number }

export async function buscarAvisosLegalizacao(
    getToken: () => Promise<string>,
    deps: { fetchImpl?: typeof fetch; dias?: number } = {},
): Promise<AvisosLegalizacao | null> {
    const doFetch = deps.fetchImpl ?? fetch;
    const dias = deps.dias ?? 30;
    try {
        const token = await getToken();
        const resp = await doFetch(`${CFI_URL}/api/admin/cadastro/avisos-legalizacao?destino=financeiro&dias=${dias}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok || corpo?.ok !== true || !Array.isArray(corpo.avisos)) return null;
        return { avisos: corpo.avisos, cortado: corpo.cortado === true, dias: Number(corpo.dias) || dias };
    } catch {
        return null;
    }
}

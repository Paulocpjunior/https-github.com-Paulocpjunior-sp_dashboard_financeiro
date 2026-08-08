/**
 * services/cadastroCentralConferencia.ts — as cobranças do Financeiro
 * conferidas contra o cadastro central do CFI (08/08).
 *
 * Este app é BASE JOTFORM (Paulo, 08/08): o cliente da transação é texto
 * digitado, com cpfCnpj opcional. Não existe cadastro próprio de empresas —
 * então a conferência aqui NÃO vigia o passado inteiro (nome livre e CPF de
 * pessoa física virariam alarme sem ação): ela olha SÓ as transações com
 * CNPJ preenchido e acende as que apontam para um CNPJ que o cadastro
 * central não conhece.
 *
 * CNPJ fora do central = ou digitado errado no Jotform (a cobrança vai bater
 * no cliente errado), ou cliente fora do cadastro do CFI — e aí fora de
 * TODOS os módulos. Quem arruma é gente, na fonte. CPF (11 dígitos) fica de
 * fora: pessoa física não é empresa do cadastro central.
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

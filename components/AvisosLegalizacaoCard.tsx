import React, { useEffect, useState } from 'react';
import { buscarAvisosLegalizacao, detalheAviso, CAMPO_AVISO, type AvisosLegalizacao } from '../services/cadastroCentralConferencia';
import { auth } from '../services/firebaseConfig';

// 📣 Avisos da Legalização (fase 4, 26/10): o que mudou no cadastro geral das
// empresas, vindo do checklist da Legalização pelo túnel do CFI. Só mostra.

const COR: Record<string, string> = {
  empresa_entrou: 'border-emerald-500', empresa_reativada: 'border-emerald-500',
  empresa_suspensa: 'border-amber-500', empresa_saiu: 'border-red-500', empresa_baixada: 'border-red-500',
};
const fmtCnpj = (d: string) => (d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d);

const AvisosLegalizacaoCard: React.FC = () => {
  // undefined = carregando; null = o CFI não respondeu (aparece, não some).
  const [dados, setDados] = useState<AvisosLegalizacao | null | undefined>(undefined);
  const [aberto, setAberto] = useState(true);
  useEffect(() => {
    let vivo = true;
    buscarAvisosLegalizacao(async () => {
      const u = auth.currentUser;
      if (!u) throw new Error('sem sessão Firebase');
      return await u.getIdToken();
    }).then((r) => { if (vivo) setDados(r); });
    return () => { vivo = false; };
  }, []);
  if (dados === undefined) return null;
  if (dados === null) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
        📣 Não carregou os avisos da Legalização: o CFI não respondeu. Recarregue a página; se continuar, avise o Paulo.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-start justify-between gap-3 text-left">
        <span>
          <span className="block font-extrabold text-slate-800">
            📣 Avisos da Legalização ({dados.avisos.length}{dados.cortado ? '+' : ''})
          </span>
          <span className="block text-xs text-slate-500">
            Empresas que entraram, mudaram de situação, de dados ou de serviços nos últimos {dados.dias} dias, pelo checklist da Legalização. Nenhuma cobrança muda sozinha.
          </span>
        </span>
        <span className="text-xs text-slate-500">{aberto ? 'Ocultar' : 'Mostrar'}</span>
      </button>
      {aberto && dados.avisos.length === 0 && (
        <p className="text-xs text-slate-500 mt-2">Nenhum aviso nos últimos {dados.dias} dias.</p>
      )}
      {aberto && dados.avisos.length > 0 && (
        <ul className="mt-3 space-y-2">
          {dados.avisos.map((a) => (
            <li key={a.id} className={`pl-3 py-1 border-l-4 ${COR[a.tipo] ?? 'border-blue-500'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <strong className="text-slate-800">{a.empresaNome || '—'}</strong>
                {a.cnpj && <span className="text-xs font-mono text-slate-500">{fmtCnpj(a.cnpj)}</span>}
                <span className="text-xs font-semibold text-slate-700">
                  {a.rotulo}{a.campos.length ? `: ${a.campos.map((c) => CAMPO_AVISO[c] ?? c).join(', ')}` : ''}
                </span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {a.em ? new Date(a.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sem data'}
                  {a.porNome ? ` · ${a.porNome}` : ''}
                </span>
              </div>
              {detalheAviso(a).length > 0 && <div className="text-xs text-slate-800">{detalheAviso(a).join(' · ')}</div>}
              {a.acao && <div className="text-xs text-slate-600">{a.acao}</div>}
            </li>
          ))}
        </ul>
      )}
      {aberto && dados.cortado && <p className="text-[11px] text-slate-500 mt-2">Mostrando os mais recentes; há mais avisos no período.</p>}
    </div>
  );
};

export default AvisosLegalizacaoCard;

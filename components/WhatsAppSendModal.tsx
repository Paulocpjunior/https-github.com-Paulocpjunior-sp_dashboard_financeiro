import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, ShieldCheck, X } from 'lucide-react';
import {
  SpConnectGateway,
  SpConnectMetaTemplate,
  SpConnectRegisteredTemplate,
} from '../services/spConnectGateway';

interface WhatsAppSendModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  preparedText: string;
  initialContactName?: string;
  initialPhone?: string;
}

const normalizeKey = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const suggestedValue = (key: string, preparedText: string, contactName: string) => {
  const normalized = normalizeKey(key);
  if (['mensagem', 'resumo', 'informacao', 'informacoes', 'conteudo', 'texto'].includes(normalized)) return preparedText;
  if (['cliente', 'nome', 'nomedocliente', 'contato'].includes(normalized)) return contactName;
  if (['data', 'datadeenvio'].includes(normalized)) return new Date().toLocaleDateString('pt-BR');
  return '';
};

export const WhatsAppSendModal: React.FC<WhatsAppSendModalProps> = ({
  open,
  onClose,
  title,
  preparedText,
  initialContactName = '',
  initialPhone = '',
}) => {
  const preparedForTemplate = useMemo(
    () => preparedText.replace(/\s*\n+\s*/g, ' | ').replace(/\s+/g, ' ').trim(),
    [preparedText]
  );
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [phone, setPhone] = useState(initialPhone);
  const [contactName, setContactName] = useState(initialContactName);
  const [registered, setRegistered] = useState<SpConnectRegisteredTemplate[]>([]);
  const [meta, setMeta] = useState<SpConnectMetaTemplate[]>([]);
  const [selection, setSelection] = useState('');
  const [namedValues, setNamedValues] = useState<Record<string, string>>({});
  const [positionalValues, setPositionalValues] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ number: string; messageId: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhone(initialPhone);
    setContactName(initialContactName);
    setSelection('');
    setNamedValues({});
    setPositionalValues([]);
    setConfirmed(false);
    setError(null);
    setSuccess(null);
    setLoading(true);

    SpConnectGateway.getAvailability()
      .then(({ status, registered: registeredTemplates, meta: metaTemplates, error: loadError }) => {
        setRegistered(registeredTemplates);
        setMeta(metaTemplates);
        if (loadError) setError(loadError);
        else if (!status.pronto) setError('O canal do SP Connect está temporariamente indisponível.');
        else if (!registeredTemplates.length && !metaTemplates.length) {
          setError('Não há modelo de mensagem sem anexo aprovado para iniciar a conversa. Cadastre ou aprove um modelo no SP Connect.');
        }
      })
      .catch(() => setError('Não foi possível carregar os modelos do SP Connect.'))
      .finally(() => setLoading(false));
  }, [open, initialContactName, initialPhone]);

  const selectedRegistered = selection.startsWith('registered:')
    ? registered.find((item) => item.id === selection.slice('registered:'.length))
    : undefined;
  const selectedMeta = selection.startsWith('meta:')
    ? meta.find((item) => `${item.nome}|${item.idioma}` === selection.slice('meta:'.length))
    : undefined;

  const phoneDigits = phone.replace(/\D/g, '');
  const valuesComplete = selectedRegistered
    ? (selectedRegistered.variaveis || []).every((item) => (namedValues[item.chave] || '').trim())
    : selectedMeta
      ? Array.from({ length: selectedMeta.variaveis }, (_, index) => positionalValues[index] || '')
          .every((value) => value.trim())
      : false;
  const canSend = phoneDigits.length >= 10 && phoneDigits.length <= 13 && valuesComplete && confirmed && !sending;

  const templatePreview = useMemo(() => {
    if (!selectedMeta?.corpo) return '';
    return selectedMeta.corpo.replace(/\{\{(\d+)\}\}/g, (_match, index) => {
      const value = positionalValues[Number(index) - 1];
      return value?.trim() ? value : `{{${index}}}`;
    });
  }, [selectedMeta, positionalValues]);

  const selectTemplate = (value: string) => {
    setSelection(value);
    setConfirmed(false);
    setError(null);
    setNamedValues({});
    setPositionalValues([]);

    if (value.startsWith('registered:')) {
      const item = registered.find((template) => template.id === value.slice('registered:'.length));
      if (item) {
        setNamedValues(Object.fromEntries(
          (item.variaveis || []).map((variable) => [
            variable.chave,
            suggestedValue(variable.chave, preparedForTemplate, contactName),
          ])
        ));
      }
    } else if (value.startsWith('meta:')) {
      const item = meta.find((template) => `${template.nome}|${template.idioma}` === value.slice('meta:'.length));
      if (item?.variaveis === 1) setPositionalValues([preparedForTemplate]);
    }
  };

  const send = async () => {
    if (!canSend || (!selectedRegistered && !selectedMeta)) return;
    setSending(true);
    setError(null);
    const result = await SpConnectGateway.startConversation({
      para: phone,
      nomeContato: contactName.trim() || undefined,
      ...(selectedRegistered
        ? { template: selectedRegistered.nome, variaveis: namedValues }
        : {
            templateDireto: { nome: selectedMeta!.nome, idioma: selectedMeta!.idioma },
            variaveisPosicionais: positionalValues.slice(0, selectedMeta!.variaveis),
          }),
    });
    setSending(false);

    if (!result.ok) {
      setError(
        result.indeterminado
          ? `${result.error || 'O envio ficou sem confirmação.'} Verifique a conversa no SP Connect antes de tentar novamente.`
          : [result.error, result.acao].filter(Boolean).join(' ')
      );
      return;
    }
    setSuccess({ number: String(result.numero || phoneDigits), messageId: String(result.messageId || '') });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm print:hidden" onClick={onClose}>
      <div className="my-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><MessageCircle className="h-5 w-5" /></div>
            <div><h2 className="font-bold text-slate-900 dark:text-white">{title}</h2><p className="text-xs text-slate-500">Envio pelo SP Connect · WhatsApp oficial</p></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          {success ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
              <h3 className="font-bold text-emerald-800 dark:text-emerald-300">Mensagem aceita pelo SP Connect</h3>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">Destino: {success.number}</p>
              {success.messageId && <p className="mt-1 break-all text-[11px] text-slate-500">ID Meta: {success.messageId}</p>}
              <button type="button" onClick={onClose} className="mt-4 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700">Concluir</button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-blue-800 dark:text-blue-300"><ShieldCheck className="h-4 w-4" />Informação preparada pelo painel</div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-blue-900 dark:text-blue-200">{preparedText}</pre>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">WhatsApp do destinatário
                  <input value={phone} onChange={(event) => { setPhone(event.target.value); setConfirmed(false); }} placeholder="(11) 99999-9999" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Nome do contato (opcional)
                  <input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome ou empresa" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
              </div>

              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Modelo aprovado pela Meta
                <select value={selection} onChange={(event) => selectTemplate(event.target.value)} disabled={loading} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                  <option value="">{loading ? 'Carregando modelos…' : 'Selecione o modelo da mensagem'}</option>
                  {registered.length > 0 && <optgroup label="Financeiro — modelos cadastrados">{registered.map((item) => <option key={item.id} value={`registered:${item.id}`}>{item.descricao || item.nome}</option>)}</optgroup>}
                  {meta.length > 0 && <optgroup label="Modelos aprovados diretamente na Meta">{meta.map((item) => <option key={`${item.nome}|${item.idioma}`} value={`meta:${item.nome}|${item.idioma}`}>{item.nome} ({item.idioma})</option>)}</optgroup>}
                </select>
              </label>

              {selectedRegistered && (selectedRegistered.variaveis || []).map((variable) => (
                <label key={variable.chave} className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{variable.rotulo || variable.chave}
                  <textarea value={namedValues[variable.chave] || ''} onChange={(event) => { setNamedValues((current) => ({ ...current, [variable.chave]: event.target.value })); setConfirmed(false); }} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
              ))}

              {selectedMeta && (
                <div className="space-y-3">
                  {templatePreview && <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">{templatePreview}</div>}
                  {Array.from({ length: selectedMeta.variaveis }, (_, index) => (
                    <label key={index} className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Valor de {`{{${index + 1}}}`}
                      <textarea value={positionalValues[index] || ''} onChange={(event) => { setPositionalValues((current) => { const next = [...current]; next[index] = event.target.value; return next; }); setConfirmed(false); }} rows={index === 0 ? 3 : 2} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      {preparedForTemplate && positionalValues[index] !== preparedForTemplate && <button type="button" onClick={() => { setPositionalValues((current) => { const next = [...current]; next[index] = preparedForTemplate; return next; }); setConfirmed(false); }} className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700">Usar o resumo preparado neste campo</button>}
                    </label>
                  ))}
                </div>
              )}

              {error && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
                <span>Revisei o número, o modelo e todos os valores. Confirmo o envio desta informação ao destinatário.</span>
              </label>
            </>
          )}
        </div>

        {!success && <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancelar</button>
          <button type="button" disabled={!canSend} onClick={send} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}{sending ? 'Enviando…' : 'Enviar pelo SP Connect'}
          </button>
        </div>}
      </div>
    </div>
  );
};

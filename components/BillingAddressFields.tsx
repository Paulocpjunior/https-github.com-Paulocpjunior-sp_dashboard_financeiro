import React, { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { BillingAddress, lookupCep } from '../services/billingAddressService';

const labels: [keyof BillingAddress, string, string][] = [
  ['cep', 'CEP', 'sm:col-span-1'],
  ['uf', 'UF', 'sm:col-span-1'],
  ['localidade', 'Cidade', 'sm:col-span-2'],
  ['logradouro', 'Logradouro', 'sm:col-span-2'],
  ['numero', 'Número', 'sm:col-span-1'],
  ['complemento', 'Complemento (opcional)', 'sm:col-span-1'],
  ['bairro', 'Bairro', 'sm:col-span-2'],
];
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 font-normal';

// Campos do endereço de cobrança do boleto, com busca do CEP.
export default function BillingAddressFields({ value, onChange, disabled, idPrefix }: {
  value: BillingAddress;
  onChange: (next: BillingAddress) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState('');
  const fillFromCep = async (cep: string) => {
    if (cep.replace(/\D/g, '').length !== 8) return;
    setLooking(true);
    setNotice('');
    try {
      const found = await lookupCep(cep);
      if (found) onChange({ ...value, cep, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v)) });
      else setNotice('CEP não encontrado. Preencha o endereço manualmente.');
    } catch {
      setNotice('Busca de CEP indisponível. Preencha o endereço manualmente.');
    } finally {
      setLooking(false);
    }
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {labels.map(([key, label, span]) => (
        <label key={key} htmlFor={`${idPrefix}-${key}`} className={`text-sm font-semibold text-slate-700 dark:text-slate-200 col-span-2 ${span}`}>
          {label}
          <span className="relative block">
            <input
              id={`${idPrefix}-${key}`}
              className={inputClass}
              value={value[key] || ''}
              maxLength={key === 'uf' ? 2 : key === 'cep' ? 9 : 120}
              inputMode={key === 'cep' ? 'numeric' : undefined}
              autoComplete="off"
              disabled={disabled}
              onChange={(e) => {
                const next = { ...value, [key]: key === 'uf' ? e.target.value.toUpperCase() : e.target.value };
                onChange(next);
                if (key === 'cep' && e.target.value.replace(/\D/g, '').length === 8) fillFromCep(e.target.value);
              }}
            />
            {key === 'cep' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
                {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </span>
            )}
          </span>
        </label>
      ))}
      {notice && <p role="status" className="col-span-2 sm:col-span-4 text-xs text-amber-700 dark:text-amber-300">{notice}</p>}
    </div>
  );
}

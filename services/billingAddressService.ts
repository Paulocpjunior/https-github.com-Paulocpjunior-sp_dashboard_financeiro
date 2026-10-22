import { customerApi } from './customerDirectory';

// Endereço de cobrança usado na emissão de boletos. Fica no cadastro do cliente
// (CPF/CNPJ ou N.Cliente); qualquer colaborador ativo corrige, sempre com log.
export type BillingAddress = {
  cep: string;
  uf: string;
  localidade: string;
  bairro: string;
  logradouro: string;
  numero: string;
  complemento: string;
};
export const emptyBillingAddress = (): BillingAddress => ({ cep: '', uf: '', localidade: '', bairro: '', logradouro: '', numero: '', complemento: '' });
export const REQUIRED_ADDRESS_KEYS: (keyof BillingAddress)[] = ['cep', 'uf', 'localidade', 'bairro', 'logradouro', 'numero'];
export const isAddressComplete = (a?: Partial<BillingAddress> | null) => Boolean(a) && REQUIRED_ADDRESS_KEYS.every((k) => String(a?.[k] || '').trim());
export const isAddressEmpty = (a?: Partial<BillingAddress> | null) => !a || Object.values(a).every((v) => !String(v || '').trim());

export async function fetchBillingAddress(sourceId: string): Promise<{ identityKey: string; address: BillingAddress | null; updatedAt: string | null; updatedBy: string | null }> {
  return customerApi(`billing-address?sourceId=${encodeURIComponent(sourceId)}`);
}

export async function saveBillingAddress(sourceId: string, address: BillingAddress, origin: string): Promise<{ identityKey: string; address: BillingAddress }> {
  return customerApi('billing-address', { requestId: crypto.randomUUID(), sourceId, address, origin });
}

// Consulta pública de CEP (ViaCEP). Só preenche campos; a pessoa confere antes de salvar.
export async function lookupCep(cep: string): Promise<Partial<BillingAddress> | null> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = await response.json();
  if (data.erro) return null;
  return { uf: data.uf || '', localidade: data.localidade || '', bairro: data.bairro || '', logradouro: data.logradouro || '' };
}

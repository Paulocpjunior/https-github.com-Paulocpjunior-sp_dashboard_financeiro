// Contas do Financeiro compartilham a mesma caixa (financeiro@). O login é pelo
// usuário, mas o Firebase Auth exige e-mail único por conta. O apelido
// "local+usuario@dominio" mantém a entrega na mesma caixa e preserva o domínio,
// que é o que a trava de envio do WhatsApp cobra.
export const buildAuthEmailAlias = (email: string, username: string): string | null => {
  const clean = String(email || '').trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at <= 0) return null;

  const domain = clean.slice(at + 1);
  if (!domain.includes('.')) return null;

  const base = clean.slice(0, at).split('+')[0];
  const tag = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!base || !tag) return null;

  const alias = `${base}+${tag}@${domain}`;
  return alias === clean ? null : alias;
};

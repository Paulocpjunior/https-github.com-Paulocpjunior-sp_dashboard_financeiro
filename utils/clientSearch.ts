const normalize = (value: unknown) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Busca tolerante a pontuação: "RADIO SB FM LTDA - 07147345000111" ou "07.147.345/0001-11"
 * encontram o cliente; cada palavra digitada precisa aparecer no nome, documento ou número.
 */
export const matchesClientSearch = (parts: unknown[], query: string): boolean => {
  const tokens = normalize(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return true;
  const text = ` ${normalize(parts.join(' ')).replace(/[^a-z0-9]+/g, ' ')} `;
  const digits = parts.map(part => String(part || '').replace(/\D/g, '')).join(' ');
  return tokens.every(token => text.includes(token) || (/^\d+$/.test(token) && digits.includes(token)));
};

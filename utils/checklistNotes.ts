/** Converter observações em texto; nunca inserir o HTML recebido no documento. */
export function readableChecklistNotes(value: string | null) {
  if (!value) return 'Sem observações.';
  const plain = value.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:div|p|li)\s*>/gi, '\n').replace(/<[^>]*>/g, '');
  const decoder = document.createElement('textarea');
  decoder.innerHTML = plain;
  return decoder.value.trim() || 'Sem observações.';
}

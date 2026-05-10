const isoDateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;

export const toLocalISODate = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseISODateAsLocal = (dateStr: string): Date | null => {
  const match = dateStr.match(isoDateRegex);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, monthIndex, day);
};

export const formatISODateBR = (
  dateStr: string | undefined | null,
  options?: Intl.DateTimeFormatOptions
): string => {
  if (!dateStr || dateStr === '1970-01-01') return '';

  const localDate = parseISODateAsLocal(dateStr);
  if (!localDate || Number.isNaN(localDate.getTime())) return '';

  return localDate.toLocaleDateString('pt-BR', options);
};

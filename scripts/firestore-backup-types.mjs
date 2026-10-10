// Preserve REST values that JSON alone cannot distinguish (timestamps, int64, references...).
export function collectTypeOverrides(fields, path = []) {
  const result = [];
  const visit = (value, at) => {
    if ('mapValue' in value) for (const [key, child] of Object.entries(value.mapValue.fields || {})) visit(child, [...at, key]);
    else if ('arrayValue' in value) (value.arrayValue.values || []).forEach((child, index) => visit(child, [...at, index]));
    else if (!('stringValue' in value || 'booleanValue' in value || 'nullValue' in value)) result.push({path: at, value});
  };
  for (const [key,value] of Object.entries(fields)) visit(value,[...path,key]);
  return result;
}
export function restoreTypedFields(document) {
  if (!Array.isArray(document.typeOverrides)) throw Error('Backup sem tipos originais.');
  const overrides = new Map(document.typeOverrides.map(x => [JSON.stringify(x.path), x.value]));
  const encode = (value, path) => {
    const key = JSON.stringify(path);
    if (overrides.has(key)) return overrides.get(key);
    if (value === null) return {nullValue:null};
    if (typeof value === 'string') return {stringValue:value};
    if (typeof value === 'boolean') return {booleanValue:value};
    if (typeof value === 'number') throw Error('Número sem tipo original.');
    if (Array.isArray(value)) return {arrayValue:{values:value.map((v,i)=>encode(v,[...path,i]))}};
    if (value && typeof value === 'object') return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v,[...path,k])]))}};
    throw Error('Tipo não suportado no backup.');
  };
  return Object.fromEntries(Object.entries(document.data).map(([key,value])=>[key,encode(value,[key])]));
}

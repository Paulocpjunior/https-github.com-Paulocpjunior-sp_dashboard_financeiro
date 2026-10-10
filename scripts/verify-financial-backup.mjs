#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHILD_COLLECTIONS } from './export-firestore-data.mjs';

export function verifyFinancialBackup(backup) {
  if (backup.schemaVersion !== 2 || !Number.isFinite(Date.parse(backup.readTime))) throw Error('Backup sem versão ou instante de leitura consistente.');
  const names = new Set(), paths = new Set();
  const prefix = `projects/${backup.projectId}/databases/${backup.database}/documents/`;
  let total = 0;
  for (const collection of backup.collections) {
    if (names.has(collection.name)) throw Error('Coleção repetida: ' + collection.name);
    names.add(collection.name);
    if (collection.count !== collection.documents.length) throw Error('Contagem divergente: ' + collection.name);
    for (const document of collection.documents) {
      if (!document.path?.startsWith(prefix + collection.name + '/') || document.path.slice((prefix + collection.name + '/').length).includes('/')) throw Error('Caminho de documento inválido.');
      if (paths.has(document.path)) throw Error('Documento repetido.');
      paths.add(document.path); total++;
    }
  }
  for (const name of backup.scope.firestore) if (!names.has(name)) throw Error('Coleção ausente: ' + name);
  for (const collection of backup.collections) {
    const children = CHILD_COLLECTIONS[collection.name] || [];
    for (const document of collection.documents) for (const child of children) {
      if (!names.has(document.path.slice(prefix.length) + '/' + child)) throw Error('Subcoleção ausente: ' + child);
    }
  }
  if (backup.counts.totalDocuments !== total || backup.counts.collections !== names.size) throw Error('Totais do manifesto divergentes.');
  return { valid: true, readTime: backup.readTime, collections: names.size, documents: total,
    storageObjectsIncluded: false, authAccountsIncluded: false, restoreTestPerformed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw Error('Informe o caminho exato do backup JSON.');
    const bytes = readFileSync(process.argv[2]);
    const expected = readFileSync(process.argv[2] + '.sha256', 'utf8').split(/\s/)[0];
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('Checksum divergente.');
    console.log(JSON.stringify(verifyFinancialBackup(JSON.parse(bytes)), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

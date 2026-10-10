import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { emulatorEndpoint, verifyManifest, canonicalFields } from './restore-financial-drill.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
for(const host of ['firestore.googleapis.com:443','localhost.evil:8080','127.0.0.1:8080/path','[::]:8080',''])assert.throws(()=>emulatorEndpoint(host));
assert.match(emulatorEndpoint('127.0.0.1:8188'),/demo-financeiro-restore/);
const dir=mkdtempSync(join(tmpdir(),'test-recovery-'));const path=join(dir,'manifest.json');
const data='{"test":true}';writeFileSync(join(dir,'firestore.json'),data);
const manifest={files:[{file:'firestore.json',size:Buffer.byteLength(data),sha256:hash(data)}]};
function write(m){const b=JSON.stringify(m);writeFileSync(path,b);writeFileSync(join(dir,'manifest.sha256'),hash(b));}
write(manifest);assert.equal(verifyManifest(path).root,dir);
writeFileSync(join(dir,'firestore.json'),'changed');assert.throws(()=>verifyManifest(path),/divergente/);
write({files:[{file:'../outside',size:0,sha256:''}]});assert.throws(()=>verifyManifest(path),/fora/);
write(manifest);writeFileSync(path,'{}');assert.throws(()=>verifyManifest(path),/adulterado/);
console.log('OK: restauração recusa produção, caminhos externos e pacotes adulterados.');

assert.deepEqual(canonicalFields({a:{arrayValue:{}},m:{mapValue:{}},t:{timestampValue:"2026-01-01T00:00:00.000Z"}}),canonicalFields({a:{arrayValue:{values:[]}},m:{mapValue:{fields:{}}},t:{timestampValue:"2026-01-01T00:00:00Z"}}));

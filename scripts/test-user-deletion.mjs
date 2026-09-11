import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let actor = { id: 'admin-uid', username: 'admin', role: 'admin' };
let profile;
let writes;
const source = readFileSync('services/userAdminService.ts', 'utf8').replace(/^import .*;\n/gm, '').replace('export const UserAdminService', 'const UserAdminService').replace(/export interface/g, 'interface');
const context = vm.createContext({
  AuthService: { getCurrentUser: () => actor, isAuthenticated: () => true },
  db: {}, doc: (_db, collection, id) => ({ collection, id }),
  runTransaction: async (_db, callback) => callback({
    get: async () => ({ exists: () => profile !== null, data: () => profile }),
    update: (ref, patch) => writes.push({ ref, patch }),
  }),
});
vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }) + '\nglobalThis.service = UserAdminService;', context);
const reset = () => { profile = { username: 'ex.colaborador', role: 'operacional', active: true }; writes = []; };
reset();
let result = await context.service.deleteFormerEmployee('employee', 'ex.colaborador');
assert.equal(result.success, true);
assert.equal(writes.length, 1);
assert.equal(writes[0].ref.collection, 'users');
assert.equal(writes[0].patch.active, false);
assert.equal(writes[0].patch.status, 'deleted');
assert.equal(writes[0].patch.financialPermissions.length, 0);
assert.equal(writes[0].patch.deletedBy, 'admin-uid');
for (const scenario of ['wrong confirmation', 'admin target', 'self', 'missing', 'operator']) {
  reset(); actor.role = 'admin';
  if (scenario === 'admin target') profile.role = 'admin';
  if (scenario === 'missing') profile = null;
  if (scenario === 'operator') actor.role = 'operacional';
  result = await context.service.deleteFormerEmployee(scenario === 'self' ? actor.id : 'employee', scenario === 'wrong confirmation' ? 'other' : 'ex.colaborador');
  assert.equal(result.success, false, scenario);
  assert.equal(writes.length, 0, scenario);
}
reset(); actor.role = 'admin'; profile.status = 'deleted';
assert.equal((await context.service.deleteFormerEmployee('employee', 'ex.colaborador')).success, true);
assert.equal(writes.length, 0);
console.log('OK: exclusão preserva histórico, revoga permissões e rejeita alvo/ator/confirmação inválidos.');

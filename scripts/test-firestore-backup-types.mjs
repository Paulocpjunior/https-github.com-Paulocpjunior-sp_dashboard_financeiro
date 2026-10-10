import assert from 'node:assert/strict';
import { collectTypeOverrides, restoreTypedFields } from './firestore-backup-types.mjs';
const raw={date:{timestampValue:'2026-10-10T12:00:00Z'},integer:{integerValue:'9223372036854775807'},amount:{doubleValue:10.25},blob:{bytesValue:'YWJj'},ref:{referenceValue:'projects/p/databases/(default)/documents/c/a'},point:{geoPointValue:{latitude:1,longitude:2}},nested:{mapValue:{fields:{items:{arrayValue:{values:[{integerValue:'1'},{stringValue:'1'}]}}}}},empty:{mapValue:{fields:{}}},nil:{nullValue:null},bool:{booleanValue:true},nan:{doubleValue:'NaN'}};
const data={date:'2026-10-10T12:00:00Z',integer:9223372036854775807,amount:10.25,blob:'YWJj',ref:'projects/p/databases/(default)/documents/c/a',point:{latitude:1,longitude:2},nested:{items:[1,'1']},empty:{},nil:null,bool:true,nan:null};
const backup=JSON.parse(JSON.stringify({data,typeOverrides:collectTypeOverrides(raw)}));
assert.deepEqual(restoreTypedFields(backup),raw);
assert.throws(()=>restoreTypedFields({data:{amount:10},typeOverrides:[]}),/sem tipo/);
assert.throws(()=>restoreTypedFields({data}),/sem tipos/);
console.log('OK: timestamps, int64 exato, doubles, bytes, references, geopoints e arrays restaurados sem perda.');

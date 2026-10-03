import assert from 'node:assert/strict';
import { classifyFinancialMatches } from './lib/payables-match-classification.mjs';
assert.equal(classifyFinancialMatches([]), 'missing');
assert.equal(classifyFinancialMatches([{ data: {} }]), 'legacy');
assert.equal(classifyFinancialMatches([{ data: { submissionId: 'other' } }]), 'ambiguous');
assert.equal(classifyFinancialMatches([{ data: { submissionID: 'other' } }]), 'ambiguous');
assert.equal(classifyFinancialMatches([{ data: {} }, { data: {} }]), 'ambiguous');
console.log('OK: financial matches with another submission or multiple candidates require review.');

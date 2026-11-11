import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { project, readTrace } from './model.ts';

const trace = readTrace(fileURLToPath(new URL('./example.jsonl', import.meta.url))) as Record<string, unknown>[];
const at = (id: string) => trace.findIndex(event => event.id === id) + 1;
const stageAt = (id: string) => project(trace, at(id)).opportunities[0]?.stage;

test('same account and method count once; cross-method overlap stays visible', () => {
  const result = project([...trace, trace[0]]);
  assert.equal(result.uniqueEvents, trace.length);
  assert.equal(result.uniqueAccounts, 3);
  assert.deepEqual(result.opportunities[0]?.nominatedBy, ['warm-intro', 'public-request']);
  assert.deepEqual(result.nominations.map(m => [m.nominatedAccounts, m.fit, m['not-fit'], m.abstain]), [[1, 1, 0, 0], [1, 0, 1, 0], [2, 1, 0, 1]]);
  assert.throws(() => project([...trace, { ...trace[0], account: 'other' }]), /conflicting retry/);
});

test('a cited payment and a checked partial payment both leave the invoice open', () => {
  assert.equal(stageAt('c-6a'), 'deposit-invoiced');
  assert.equal(stageAt('p-6b'), 'deposit-invoiced');
  assert.equal(stageAt('c-6b'), 'deposit-verified');
});

test('checked payments with the wrong invoice, currency or amount fail the gate', () => {
  for (const fields of [{ invoiceId: 'different' }, { currency: 'EUR' }, { cents: 62499 }, { status: 'pending' }]) {
    const input = structuredClone(trace);
    const settled = input[at('p-6b') - 1];
    settled.payment = { ...settled.payment as object, ...fields };
    assert.equal(project(input, at('c-6b')).opportunities[0]?.stage, 'deposit-invoiced');
  }
});

test('invalidation withdraws dependent gates and preserves their prior projection', () => {
  assert.equal(stageAt('c-10'), 'balance-verified');
  assert.equal(stageAt('x-6b'), 'deposit-invoiced');
  assert.deepEqual(project(JSON.parse(JSON.stringify(trace))), project(trace));
});

test('a revised scope requires fresh acceptance tied to that revision', () => {
  const input = [...trace.slice(0, at('c-6b')), { ...trace[at('p-3') - 1], id: 'p-3-rev2' },
    { id: 'c-3-rev2', kind: 'check', target: 'p-3-rev2', ref: 'fixture:checked-revised-scope' }];
  assert.equal(project(input).opportunities[0]?.stage, 'proposed');
  input.push({ id: 'x-3-rev2', kind: 'invalidate', target: 'p-3-rev2', ref: 'fixture:revised-scope-withdrawn' });
  assert.equal(project(input).opportunities[0]?.stage, 'qualified');
});

test('one payment cannot satisfy both invoice milestones', () => {
  const input = structuredClone(trace);
  const balance = input[at('p-10') - 1];
  balance.payment = { ...balance.payment as object, paymentId: 'fixture-payment-settled' };
  assert.throws(() => project(input), /payment already assigned/);
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readTrace } from '../model.ts';

const [, , url] = process.argv;
const token = process.env.SALES_PILOT_TOKEN;
if (!url || !token) throw new Error('Usage: set SALES_PILOT_TOKEN and pass the service URL');
const base = new URL(url);
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
  throw new Error('Use HTTPS or a loopback development URL');
}
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const projectionPath = '/v1/smoke/projection';
const request = (path: string, options?: RequestInit) => fetch(new URL(path, base), { ...options, redirect: 'error', signal: AbortSignal.timeout(25_000) });
const projection = async (through?: number) => {
  const res = await request(projectionPath + (through === undefined ? '' : `?through=${through}`), { headers });
  assert.equal(res.status, 200, 'protected projection');
  return res.json();
};
const append = (events: unknown[]) => request('/v1/smoke/events', { method: 'POST', headers, body: JSON.stringify(events) });
const prefix = `smoke-${randomUUID().slice(0, 8)}-`;
const fixture = readTrace(fileURLToPath(new URL('../example.jsonl', import.meta.url))) as Record<string, unknown>[];
for (const event of fixture) {
  for (const key of ['id', 'target', 'account', 'basis', 'invoiceId']) if (typeof event[key] === 'string') event[key] = prefix + event[key];
  if (event.payment) {
    const payment = event.payment as { invoiceId: string; paymentId: string };
    payment.invoiceId = prefix + payment.invoiceId;
    payment.paymentId = prefix + payment.paymentId;
  }
}
const stage = (result: { opportunities: { account: string; stage: string }[] }) => result.opportunities.find(row => row.account === prefix + 'example-a')?.stage;

assert.equal((await request('/healthz')).status, 200);
assert.equal((await request(projectionPath)).status, 401);
assert.equal((await request('/v1/smoke/events', { method: 'POST', body: '[]' })).status, 401);
const before = await projection();
const pilotBefore = await request('/v1/pilot/projection', { headers }).then(res => res.json());
const first = fixture.slice(0, 23);
const concurrent = await Promise.all([append(first), append(first)]);
assert.deepEqual(concurrent.map(res => res.status).sort(), [200, 201]);
assert.equal(stage(await projection()), 'deposit-invoiced');
assert.equal((await projection()).through, before.through + 23);
assert.equal((await append([{ ...fixture[0], ref: 'fixture:conflicting-retry' }])).status, 409);
const invalid = { id: prefix + 'invalid', kind: 'check', target: prefix + 'missing', ref: 'fixture:invalid-target' };
assert.equal((await append([fixture[23], invalid])).status, 422);
assert.equal((await projection()).through, before.through + 23);
assert.equal((await append(fixture.slice(23, 33))).status, 201);
assert.equal(stage(await projection()), 'balance-verified');
assert.equal((await append(fixture.slice(33))).status, 201);
assert.equal(stage(await projection()), 'deposit-invoiced');
assert.equal(stage(await projection(before.through + 33)), 'balance-verified');
assert.deepEqual(await request('/v1/pilot/projection', { headers }).then(res => res.json()), pilotBefore);
console.log(JSON.stringify({ service: base.origin, synthetic: true, checked: ['health', 'authorization', 'concurrent retry', 'atomic rejection', 'payment gates', 'historical replay', 'ledger isolation'] }));

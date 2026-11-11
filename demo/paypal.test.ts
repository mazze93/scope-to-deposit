import { expect, test } from 'bun:test';
import { reconcile, sandbox, type Invoice } from './paypal.ts';

const id = 'INV2-Z56S-5LLA-Q52L-CPZ5';
const ref = 'scope-abc';
const usd = (value: string) => ({ currency_code: 'USD', value });
const transaction = (payment_id: string, value: string) => ({ type: 'PAYPAL', payment_id, amount: usd(value) });
const invoice: Invoice = {
  id, status: 'PAID', detail: { reference: ref }, amount: usd('625.00'), due_amount: usd('0.00'),
  payments: { paid_amount: usd('625.00'), transactions: [transaction('first', '250.00'), transaction('second', '375.00')] },
};

test('reconciles the two distinct PayPal payments against the exact approved USD deposit', () => {
  expect(reconcile(invoice, id, ref)).toEqual({ status: 'PAID', paidCents: 62500, settled: true, paymentIds: ['first', 'second'] });
  expect(() => reconcile(invoice, id, 'different-scope')).toThrow();
  expect(() => reconcile({ ...invoice, amount: { currency_code: 'EUR', value: '625' } }, id, ref)).toThrow();
});

test('partial, pending, manually paid, refunded and duplicate receipts leave kickoff on hold', () => {
  const partial = { ...invoice, status: 'PARTIALLY_PAID', due_amount: usd('375.00'), payments: { paid_amount: usd('250.00'), transactions: [transaction('first', '250.00')] } };
  expect(reconcile(partial, id, ref)).toMatchObject({ paidCents: 25000, settled: false });
  for (const status of ['PAYMENT_PENDING', 'MARKED_AS_PAID', 'PARTIALLY_REFUNDED', 'PAID_EXTERNAL']) {
    expect(reconcile({ ...invoice, status }, id, ref).settled).toBe(false);
  }
  const duplicate = { ...invoice, payments: { ...invoice.payments, transactions: [transaction('same', '250'), transaction('same', '375')] } };
  expect(reconcile(duplicate, id, ref).settled).toBe(false);
});

test('uses the Sandbox verification API and rejects missing signature headers before the network', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push(url);
    if (url.endsWith('/token')) return Response.json({ access_token: 'fixture' });
    expect(JSON.parse(init.body as string)).toMatchObject({ webhook_id: 'hook', transmission_sig: 'signature', webhook_event: { id: 'event' } });
    return Response.json({ verification_status: 'SUCCESS' });
  }) as typeof fetch;
  const client = sandbox({ clientId: 'client', secret: 'secret', webhookId: 'hook' }, fetcher);
  expect(await client.verifyWebhook(new Headers(), {})).toBe(false);
  expect(calls).toHaveLength(0);
  const headers = new Headers({
    'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://example.test/cert',
    'paypal-transmission-id': 'id', 'paypal-transmission-sig': 'signature', 'paypal-transmission-time': 'time',
  });
  expect(await client.verifyWebhook(headers, { id: 'event' })).toBe(true);
  expect(calls).toEqual([
    'https://api-m.sandbox.paypal.com/v1/oauth2/token',
    'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
  ]);
});

import { test, expect } from 'bun:test';
import { createApp } from './app.ts';
import { sqliteStore } from './store.ts';
import type { sandbox } from './paypal.ts';
const operator = 'a'.repeat(64);
function fixture() {
    const store = sqliteStore(':memory:');
    let status = 'DRAFT';
    let cents = 0;
    let sends = 0;
    let drafts = 0;
    const paypal = {
        draft: async () => { drafts++; return 'INV2-AAAA-BBBB-CCCC-DDDD'; },
        send: async () => { sends++; status = 'SENT'; },
        invoice: async () => { const scope = await Promise.resolve(version); return { id: 'INV2-AAAA-BBBB-CCCC-DDDD', status, detail: { reference: scope, metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/test' } }, amount: { currency_code: 'USD', value: '625.00' }, due_amount: { currency_code: 'USD', value: ((62500 - cents) / 100).toFixed(2) }, payments: { paid_amount: { currency_code: 'USD', value: (cents / 100).toFixed(2) }, transactions: cents ? [{ type: 'PAYPAL', payment_id: 'PAY-1', amount: { currency_code: 'USD', value: (cents / 100).toFixed(2) } }] : [] } }; },
        verifyWebhook: async (headers: Headers) => headers.get('paypal-transmission-sig') === 'valid',
    } as unknown as ReturnType<typeof sandbox>;
    const draft = async () => ({ version: 'scope-draft', work: ['Require passing release checks.'], evidence: [{ field: 'repository' as const, quote: 'example/demo' }], missing: ['approver' as const, 'ciBaseline' as const] });
    const app = createApp({ store, operator, paypal, draft });
    let version = '';
    let buyer = '';
    async function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
        const response = await app(new Request('https://example.test' + path, { method: body ? 'POST' : 'GET', headers: { 'X-Demo-Operator': operator, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }));
        const result = response.status === 204 ? null : await response.json();
        return { response, result };
    }
    async function action(name: string, body = {}) { const result = await request('/actions/' + name, { version, ...body }); if (result.result?.scope)
        version = result.result.scope.version; return result; }
    async function accepted() {
        await action('contact', { name: 'Test Buyer', email: 'buyer@example.com', organization: 'Synthetic Co' });
        await action('scope', { inquiry: 'Please harden example/demo.' });
        const review = await action('review', { repository: 'example/demo', approver: 'Test Buyer', ciBaseline: 'Checks pass on main', nextStep: 'Meet Tuesday to review the first change.', contactPoint: 'consultant@example.com' });
        buyer = review.result.buyerToken;
        await request('/buyer/scope', { version }, { 'X-Demo-Buyer': buyer });
    }
    async function webhook(id: string, sig = 'valid') {
        return request('/webhooks/paypal', { id, event_type: 'INVOICING.INVOICE.PAID', resource: { id: 'INV2-AAAA-BBBB-CCCC-DDDD' } }, { 'paypal-transmission-sig': sig });
    }
    return { store, app, request, action, accepted, webhook, pay: (amount: number, newStatus: string) => { cents = amount; status = newStatus; }, counts: () => ({ sends, drafts }), buyer: () => buyer, version: () => version };
}
test('engagement reaches kickoff only through accepted scope, sent invoice and verified full payment; records all evidence', async () => {
    const f = fixture();
    await f.accepted();
    expect((await f.action('kickoff')).response.status).toBe(400);
    await f.action('access', { receipt: 'synthetic access check' });
    await f.action('draft');
    await f.action('draft');
    await f.action('send');
    await f.action('send');
    expect(f.counts()).toEqual({ drafts: 1, sends: 1 });
    f.pay(25000, 'PARTIALLY_PAID');
    await f.webhook('partial-event');
    expect((await f.action('kickoff')).response.status).toBe(400);
    f.pay(62500, 'PAID');
    expect((await f.webhook('full-event', 'invalid')).response.status).toBe(401);
    expect((await f.action('kickoff')).response.status).toBe(400);
    await f.webhook('full-event');
    await f.webhook('full-event');
    const final = await f.action('kickoff');
    expect(final.response.status).toBe(200);
    expect(final.result.stage).toBe('kickoff-confirmed');
    expect(final.result.confirmation.buyer.name).toBe('Test Buyer');
    expect(final.result.confirmation.receipt.paymentIds).toEqual(['PAY-1']);
    expect(final.result.confirmation.kickoff.nextStep).toContain('Tuesday');
    expect(final.result.events.map((e: any) => e.kind)).toEqual(['contact-captured', 'scope-drafted', 'scope-reviewed', 'buyer-accepted', 'access-confirmed', 'invoice-created', 'invoice-delivered', 'payment-not-settled', 'payment-verified', 'kickoff-confirmed']);
    const buyer = await f.request('/buyer/scope', undefined, { 'X-Demo-Buyer': f.buyer() });
    expect(buyer.result.confirmation.active).toBe(true);
    expect(buyer.result.buyerToken).toBeUndefined();
    f.pay(0, 'REFUNDED');
    await f.webhook('refund-event');
    const after = await f.request('/state');
    expect(after.result.ready).toBe(false);
    expect(after.result.confirmation.active).toBe(false);
    expect(after.result.events.some((e: any) => e.kind === 'kickoff-confirmed')).toBe(true);
});
test('protects operator state, binds acceptance to current version, and fixes contact after review', async () => {
    const f = fixture();
    const unauthorized = await f.app(new Request('https://example.test/state'));
    expect(unauthorized.status).toBe(401);
    const root = await f.app(new Request('https://example.test/'));
    expect(root.status).toBe(303);
    await f.accepted();
    expect((await f.request('/buyer/scope', { version: 'wrong' }, { 'X-Demo-Buyer': f.buyer() })).response.status).toBe(409);
    expect((await f.request('/buyer/scope', undefined, { 'X-Demo-Buyer': 'wrong' })).response.status).toBe(403);
    expect((await f.action('contact', { name: 'changed' })).response.status).toBe(400);
    expect((await f.request('/actions/access', { version: f.version(), receipt: 'test' }, { Origin: 'https://attacker.test' })).response.status).toBe(403);
    const page = await f.app(new Request('https://example.test/', { headers: { 'X-Demo-Operator': operator } }));
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(await page.text()).not.toContain(operator);
});
test('store rolls back failed operations and serializes concurrent transitions', async () => {
    const store = sqliteStore(':memory:');
    await expect(store.run(async (ctx) => { ctx.emit('bad', 'test', {}); throw Error('failure'); })).rejects.toThrow('failure');
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.run(async (ctx) => { ctx.emit('test', 'test', { i }); })));
    await store.run(async (ctx) => { expect(ctx.events).toHaveLength(8); expect(ctx.events.map(e => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); });
});

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { depositCents, invoiceIdPattern, reconcile, sandbox } from './paypal.ts';
import { draftScope, validateDraft } from './scope.ts';
import type { Store, Context, Engagement } from './store.ts';
import html from './index.html' with { type: 'text' };
import buyerHtml from './buyer.html' with { type: 'text' };
import helpHtml from './help.html' with { type: 'text' };
import workflowCss from './workflow.css' with { type: 'text' };
const watched = new Set(['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.REFUNDED', 'INVOICING.INVOICE.CANCELLED']);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function field(body: Record<string, unknown>, name: string, limit = 300) {
    const value = body[name];
    if (typeof value !== 'string' || !value.trim() || value.length > limit)
        throw new Error('Enter a valid ' + name + '.');
    return value.trim();
}
function shareLink(value?: string) {
    if (!value)
        return;
    const url = new URL(value);
    if (['https://www.sandbox.paypal.com', 'https://sandbox.paypal.com'].includes(url.origin) && url.pathname.startsWith('/invoice/p/'))
        return url.href;
}
function ready(state: Engagement) { return !!(state.contact && state.review && state.acceptance?.version === state.scope?.version && state.invoice?.sent && state.deposit?.settled && state.access); }
export function confirmation(state: Engagement) {
    if (!state.kickoff)
        return null;
    return { buyer: state.contact, scope: { version: state.scope!.version, work: state.scope!.work, review: state.review },
        receipt: { invoiceId: state.invoice!.id, paymentIds: state.deposit!.paymentIds, cents: depositCents, currency: 'USD', verifiedAt: state.deposit!.verifiedAt },
        kickoff: state.kickoff, active: ready(state) };
}
export function createApp(config: {
    store: Store;
    operator: string;
    local?: boolean;
    publicOrigin?: string;
    paypal?: ReturnType<typeof sandbox>;
    draft?: typeof draftScope;
}) {
    const { store, operator, paypal } = config;
    function snapshot(ctx: Context) {
        const s = ctx.state;
        const stage = s.kickoff && ready(s) ? 'kickoff-confirmed' : s.deposit?.settled ? 'payment-verified' : s.invoice?.sent ? 'invoice-delivered' : s.acceptance ? 'buyer-accepted' : s.review ? 'scope-reviewed' : s.contact ? 'contact-captured' : 'new';
        return { ...s, stage, ready: ready(s), paypalConfigured: !!paypal, storage: store.kind, buyerUrl: s.buyerToken && config.publicOrigin ? config.publicOrigin + '/buyer#' + s.buyerToken : undefined, events: ctx.events, confirmation: confirmation(s) };
    }
    function page(body: string) {
        const nonce = randomBytes(18).toString('base64');
        return new Response(body.replaceAll('<script>', '<script nonce="' + nonce + '">'), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
                'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
    }
    function session(request: Request) {
        if (equal(request.headers.get('X-Demo-Operator') ?? '', operator) || equal(request.headers.get('Authorization') ?? '', 'Bearer ' + operator))
            return true;
        const value = request.headers.get('Cookie')?.match(/(?:^|; )scope_session=([^;]+)/)?.[1];
        if (!value)
            return false;
        const [expires, nonce, sig] = value.split('.');
        return Number(expires) > Date.now() && !!nonce && !!sig && equal(sig, createHmac('sha256', operator).update(expires + '.' + nonce).digest('hex'));
    }
    async function action(ctx: Context, name: string, body: Record<string, unknown>) {
        const s = ctx.state;
        if (name === 'contact') {
            if (s.review)
                throw new Error('Buyer contact is fixed in the reviewed scope.');
            const email = field(body, 'email', 254);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                throw new Error('Enter a valid buyer email.');
            s.contact = { name: field(body, 'name'), email, organization: field(body, 'organization') };
            ctx.emit('contact-captured', 'operator', { buyer: s.contact });
            return;
        }
        if (name === 'scope') {
            if (!s.contact)
                throw new Error('Save the buyer contact first.');
            if (s.review)
                throw new Error('The reviewed scope is fixed.');
            const inquiry = field(body, 'inquiry', 4000);
            s.scope = body.localDraft ? validateDraft(inquiry, body.localDraft) : await (config.draft ?? draftScope)(inquiry);
            ctx.emit('scope-drafted', body.localDraft ? 'operator/local-ai' : 'ai', { scope: s.scope, source: body.localDraft ? 'Operator-submitted local model output; exact quotes validated by server' : 'Server model output', inquiryHash: hash(inquiry), quotedFacts: s.scope.evidence.filter(e => e.quote).length, totalFacts: 3 });
            return;
        }
        if (!s.scope || body.version !== s.scope.version)
            throw new Error('Reload and review the current scope version.');
        switch (name) {
            case 'review': {
                if (!s.contact || s.review)
                    throw new Error('Capture contact and review this scope once.');
                s.review = { repository: field(body, 'repository'), approver: field(body, 'approver'), ciBaseline: field(body, 'ciBaseline'), nextStep: field(body, 'nextStep', 600), contactPoint: field(body, 'contactPoint', 254) };
                const draftVersion = s.scope.version;
                s.scope.version = 'scope-' + hash(JSON.stringify({ draftVersion, review: s.review, buyer: s.contact })).slice(0, 32);
                s.buyerToken = randomBytes(32).toString('hex');
                ctx.emit('scope-reviewed', 'operator', { draftVersion, acceptedVersion: s.scope.version, review: s.review, buyer: s.contact, work: s.scope.work, missingFactsResolved: s.scope.missing });
                break;
            }
            case 'access': {
                if (!s.acceptance)
                    throw new Error('Record buyer acceptance first.');
                const ref = field(body, 'receipt');
                if (s.access === ref)
                    return;
                s.access = ref;
                ctx.emit('access-confirmed', 'operator', { reference: ref, version: s.scope.version });
                break;
            }
            case 'draft': {
                if (!s.acceptance || !paypal || !s.contact)
                    throw new Error('Accept the scope and configure PayPal first.');
                if (s.invoice?.id)
                    return;
                // Deterministic across transaction rollbacks so retries cannot create another invoice.
                const requestId = hash(s.id + ':' + s.scope.version).slice(0, 32);
                const id = await paypal.draft(s.contact.email, s.scope.version, requestId);
                s.invoice = { requestId, email: s.contact.email, id };
                ctx.emit('invoice-created', 'paypal', { invoiceId: id, buyer: s.contact.email, version: s.scope.version, cents: depositCents, currency: 'USD' });
                break;
            }
            case 'send': {
                if (!s.invoice?.id || !paypal)
                    throw new Error('Create a PayPal draft first.');
                if (s.invoice.sent)
                    return;
                const invoice = await paypal.invoice(s.invoice.id);
                reconcile(invoice, s.invoice.id, s.scope.version);
                if (invoice.status === 'DRAFT')
                    await paypal.send(s.invoice.id);
                const sent = await paypal.invoice(s.invoice.id);
                reconcile(sent, s.invoice.id, s.scope.version);
                if (!['SHARED', 'SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING', 'PAID'].includes(sent.status))
                    throw new Error('PayPal has not sent the invoice. Retry after checking it.');
                s.invoice.sent = true;
                s.invoice.deliveredAt = new Date().toISOString();
                s.invoice.link = shareLink(sent.detail?.metadata?.recipient_view_url);
                ctx.emit('invoice-delivered', 'paypal', { invoiceId: s.invoice.id, recipient: s.invoice.email, at: s.invoice.deliveredAt, channel: 'PayPal recipient notification', providerStatus: sent.status });
                break;
            }
            case 'kickoff': {
                if (!ready(s))
                    throw new Error('Kickoff requires accepted scope, delivered invoice, verified full payment, and confirmed access.');
                if (s.kickoff)
                    return;
                const receipt = ctx.emit('kickoff-confirmed', 'operator', { buyer: s.contact, acceptedScope: s.scope, review: s.review, invoice: s.invoice, payment: s.deposit, access: s.access, nextStep: s.review!.nextStep, contactPoint: s.review!.contactPoint });
                s.kickoff = { at: receipt.at, receipt: receipt.id, paymentEvent: s.deposit!.eventId, nextStep: s.review!.nextStep, contactPoint: s.review!.contactPoint };
                break;
            }
            default: throw new Error('Unknown action.');
        }
    }
    async function webhook(request: Request) {
        const event = await request.json().catch(() => null);
        if (!event || typeof event.id !== 'string' || !/^[A-Za-z0-9-]{1,120}$/.test(event.id))
            return json({ error: 'Invalid event.' }, 400);
        if (!paypal)
            return json({ error: 'Sandbox webhook is not configured.' }, 503);
        if (!watched.has(event.event_type))
            return new Response(null, { status: 204 });
        if (!await paypal.verifyWebhook(request.headers, event))
            return json({ error: 'Invalid webhook signature.' }, 401);
        return store.run(async (ctx) => {
            const s = ctx.state;
            const id = event.resource?.invoice?.id ?? event.resource?.id;
            if (typeof id !== 'string' || !invoiceIdPattern.test(id) || s.invoice?.id !== id)
                return new Response(null, { status: 204 });
            if (ctx.events.some(e => e.body.providerEvent === event.id))
                return new Response(null, { status: 204 });
            if (!s.scope || !s.invoice.sent)
                return json({ error: 'Invoice send is still being recorded.' }, 503);
            const result = reconcile(await paypal.invoice(id), id, s.scope.version);
            s.deposit = { ...result, eventId: event.id, verifiedAt: new Date().toISOString() };
            ctx.emit(result.settled ? 'payment-verified' : 'payment-not-settled', 'paypal', { providerEvent: event.id, eventType: event.event_type, invoiceId: id, version: s.scope.version, ...result });
            return new Response(null, { status: 204 });
        });
    }
    async function buyer(request: Request) {
        return store.run(async (ctx) => {
            const s = ctx.state;
            const token = request.headers.get('X-Demo-Buyer') ?? '';
            if (!s.scope || !s.review || !s.buyerToken || !equal(token, s.buyerToken))
                return json({ error: 'This scope link is invalid.' }, 403);
            if (request.method === 'POST') {
                const body = await request.json().catch(() => null);
                if (body?.version !== s.scope.version)
                    return json({ error: 'Review the current scope before accepting.' }, 409);
                if (!s.acceptance) {
                    const event = ctx.emit('buyer-accepted', 'buyer-link', { buyer: s.contact, version: s.scope.version, work: s.scope.work, nextStep: s.review.nextStep, contactPoint: s.review.contactPoint, method: 'possession of scoped acceptance link' });
                    s.acceptance = { version: s.scope.version, receipt: event.id, at: event.at, buyer: s.contact!.name };
                }
            }
            return json({ version: s.scope.version, work: s.scope.work, review: s.review, buyer: s.contact, accepted: !!s.acceptance, acceptance: s.acceptance, invoice: s.invoice?.sent ? { id: s.invoice.id, link: s.invoice.link } : null, payment: s.deposit?.settled ? { status: s.deposit.status, cents: depositCents } : null, confirmation: confirmation(s) });
        });
    }
    return async function fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const p = url.pathname;
        const origin = config.publicOrigin ?? url.origin;
        try {
            if (p === '/webhooks/paypal' && request.method === 'POST')
                return await webhook(request);
            if (p === '/workflow.css' && request.method === 'GET')
                return new Response(workflowCss as unknown as string, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
            if (p === '/help' && request.method === 'GET')
                return page(helpHtml as unknown as string);
            if (p === '/buyer' && request.method === 'GET')
                return page(buyerHtml as unknown as string);
            if (p === '/buyer/scope' && ['GET', 'POST'].includes(request.method))
                return await buyer(request);
            if (p === '/login' && request.method === 'GET')
                return page('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Operator sign in · Scope to Deposit</title><link rel="stylesheet" href="/workflow.css"><main class="buyer-layout"><h1>Operator sign in</h1><p>Use your private workspace token.</p><form method="post"><label>Workspace token<input type="password" name="token" required autocomplete="off"></label><button>Sign in</button></form></main></html>');
            if (p === '/login' && request.method === 'POST') {
                if (request.headers.get('Origin') !== origin)
                    return json({ error: 'Invalid origin.' }, 403);
                const body = await request.formData();
                if (!equal(String(body.get('token') ?? ''), operator))
                    return json({ error: 'Invalid workspace token.' }, 403);
                const value = (Date.now() + 8 * 60 * 60 * 1000) + '.' + randomBytes(16).toString('hex');
                const cookie = value + '.' + createHmac('sha256', operator).update(value).digest('hex');
                return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `scope_session=${cookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`, 'Cache-Control': 'no-store' } });
            }
            if (!config.local && !session(request))
                return p === '/' ? Response.redirect(origin + '/login', 303) : json({ error: 'Sign in to the operator workspace.' }, 401);
            if (p === '/' && request.method === 'GET')
                return page((html as unknown as string).replace('__OPERATOR__', config.local ? operator : ''));
            if (!session(request))
                return json({ error: 'Reload the operator screen.' }, 403);
            if (p === '/state' && request.method === 'GET')
                return await store.run(async (ctx) => json(snapshot(ctx)));
            if (p.startsWith('/actions/') && request.method === 'POST') {
                if (request.headers.has('Origin') && request.headers.get('Origin') !== origin)
                    return json({ error: 'Invalid origin.' }, 403);
                const body = await request.json().catch(() => null);
                if (!body || typeof body !== 'object' || Array.isArray(body))
                    return json({ error: 'Expected an object.' }, 400);
                return await store.run(async (ctx) => { await action(ctx, p.slice(9), body); return json(snapshot(ctx)); });
            }
            return json({ error: 'Not found.' }, 404);
        }
        catch (error) {
            // Database and provider errors never expose connection strings, credentials, or raw responses.
            return json({ error: error instanceof Error && !('code' in error) ? error.message : 'The operation could not be saved. Retry shortly.' }, 400);
        }
    };
}

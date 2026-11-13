import { randomBytes } from 'node:crypto';
import { createApp } from './app.ts';
import { sqliteStore } from './store.ts';
import { draftScope } from './scope.ts';
import { sandbox } from './paypal.ts';
const clientId = process.env.PAYPAL_SANDBOX_CLIENT_ID;
const secret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
const webhookId = process.env.PAYPAL_SANDBOX_WEBHOOK_ID;
const operator = randomBytes(32).toString('hex');
const remote = process.env.SALES_PILOT_URL;
if (remote && (new URL(remote).protocol !== 'https:' || !process.env.SALES_PILOT_TOKEN))
    throw new Error('Set the HTTPS Prisma URL and private operator token.');
const app = createApp({ store: sqliteStore(process.env.DEMO_DB ?? 'engagement.sqlite'), operator, local: true, paypal: clientId && secret && webhookId ? sandbox({ clientId, secret, webhookId }) : undefined });
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.DEMO_PORT ?? 4178), maxRequestBodySize: 64 * 1024, async fetch(request) {
        if (request.headers.get('Host') !== '127.0.0.1:' + server.port)
            return new Response('Use the local operator address.', { status: 403 });
        const url = new URL(request.url);
        if (remote && (url.pathname === '/state' || url.pathname.startsWith('/actions/'))) {
            if (request.headers.get('X-Demo-Operator') !== operator)
                return Response.json({ error: 'Reload the operator screen.' }, { status: 403 });
            if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)
                return Response.json({ error: 'Invalid origin.' }, { status: 403 });
            try {
                let body = request.method === 'POST' ? await request.json() : undefined;
                if (url.pathname === '/actions/scope') {
                    if (typeof body?.inquiry !== 'string')
                        return Response.json({ error: 'Enter an inquiry.' }, { status: 400 });
                    const draft = await draftScope(body.inquiry);
                    body = { ...body, localDraft: { work: draft.work, evidence: Object.fromEntries(draft.evidence.map(e => [e.field, e.quote])) } };
                }
                const response = await fetch(new URL(url.pathname, remote), { method: request.method, headers: { Authorization: 'Bearer ' + process.env.SALES_PILOT_TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(45000) });
                return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
            }
            catch {
                return Response.json({ error: 'The local model or Prisma service could not complete this action. Check the connection and retry.' }, { status: 503 });
            }
        }
        return app(request);
    } });
console.log('Scope to Deposit at http://127.0.0.1:' + server.port);
if (process.env.DEMO_WEBHOOK_PORT) {
    const listener = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.DEMO_WEBHOOK_PORT), maxRequestBodySize: 64 * 1024, fetch(request) {
            if (new URL(request.url).pathname !== '/webhooks/paypal' || request.method !== 'POST')
                return new Response('Not found', { status: 404 });
            return app(request);
        } });
    console.log('Webhook listener at http://127.0.0.1:' + listener.port + '/webhooks/paypal');
}

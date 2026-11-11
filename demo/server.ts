import { Database } from 'bun:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { project } from '../model.ts';
import { depositCents, invoiceIdPattern, reconcile, sandbox } from './paypal.ts';
import { draftScope } from './scope.ts';
import html from './index.html' with { type: 'text' };
import buyerHtml from './buyer.html' with { type: 'text' };
import workflowCss from './workflow.css' with { type: 'text' };
import helpHtml from './help.html' with { type: 'text' };

// Bun's HTML module declaration describes the default HTML loader. This import uses the text loader.
const page = html as unknown as string;

type Scope = Awaited<ReturnType<typeof draftScope>>;
type Deposit = ReturnType<typeof reconcile> & { eventId: string };
type Case = {
  contact?: { name: string; email: string; organization: string };
  scope?: Scope;
  review?: { repository: string; approver: string; ciBaseline: string };
  buyerToken?: string;
  acceptance?: { version: string; receipt: string };
  invoice?: { requestId: string; email: string; id?: string; sent?: boolean; link?: string };
  access?: string;
  deposit?: Deposit;
};

const db = new Database(process.env.DEMO_DB ?? 'demo.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS demo_case (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS webhook_receipt (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, status TEXT NOT NULL);
  INSERT OR IGNORE INTO demo_case VALUES (1, '{}');
`);
const read = () => JSON.parse(db.query<{ body: string }, []>('SELECT body FROM demo_case WHERE id = 1').get()!.body) as Case;
const save = (value: Case) => db.query('UPDATE demo_case SET body = ? WHERE id = 1').run(JSON.stringify(value));
const receipt = db.query('SELECT 1 FROM webhook_receipt WHERE id = ?');
const clientId = process.env.PAYPAL_SANDBOX_CLIENT_ID;
const secret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
const webhookId = process.env.PAYPAL_SANDBOX_WEBHOOK_ID;
const paypal = clientId && secret && webhookId ? sandbox({ clientId, secret, webhookId }) : null;
const operator = randomBytes(32).toString('hex');
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function snapshot(state: Case) {
  const events: Record<string, unknown>[] = [];
  const add = (stage: string, ref: string, data: Record<string, unknown> = {}) => {
    const prior = events.at(-2)?.id ?? null;
    events.push({ id: stage, kind: 'proof', account: 'demo', stage, basis: prior, ref, ...data });
    events.push({ id: 'checked-' + stage, kind: 'check', target: stage, ref });
  };
  if (state.scope) add('conversation', 'demo:inquiry');
  if (state.review && state.scope) {
    add('qualified', 'demo:operator-review');
    add('proposed', 'scope:' + state.scope.version);
  }
  if (state.acceptance?.version === state.scope?.version && state.acceptance) add('scope-accepted', 'demo:buyer-acceptance');
  if (state.invoice?.id && state.invoice.sent) {
    add('deposit-invoiced', 'paypal:' + state.invoice.id, { invoiceId: state.invoice.id });
    if (state.deposit?.settled) add('deposit-verified', 'paypal:' + state.deposit.eventId, {
      payment: { invoiceId: state.invoice.id, paymentId: state.deposit.paymentIds.join('+'), cents: depositCents, currency: 'USD', status: 'settled' },
    });
  }
  const opportunity = project(events).opportunities[0];
  return { ...state, paypalConfigured: !!paypal, stage: opportunity?.stage ?? 'waiting for inquiry', ready: opportunity?.stage === 'deposit-verified' && !!state.access };
}

function field(body: Record<string, unknown>, name: string, limit = 300) {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('Enter a valid ' + name + '.');
  return value.trim();
}

function shareLink(value?: string) {
  if (!value) return undefined;
  const link = new URL(value);
  if (link.origin !== 'https://www.sandbox.paypal.com' || !link.pathname.startsWith('/invoice/p/')) return undefined;
  return link.href;
}

let busy = false;
async function exclusive(run: () => Promise<Response>) {
  if (busy) return json({ error: 'An action is in progress. Retry shortly.' }, 503);
  busy = true;
  try { return await run(); }
  finally { busy = false; }
}

const watchedEvents = new Set(['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.REFUNDED', 'INVOICING.INVOICE.CANCELLED']);
async function webhook(request: Request) {
  if (!paypal) return json({ error: 'Sandbox webhook is not configured.' }, 503);
  const event = await request.json().catch(() => null);
  if (!event || typeof event.id !== 'string' || !/^[A-Za-z0-9-]{1,120}$/.test(event.id)) return json({ error: 'Invalid event.' }, 400);
  if (!watchedEvents.has(event.event_type)) return new Response(null, { status: 204 });
  const id = event.resource?.invoice?.id ?? event.resource?.id;
  if (typeof id !== 'string' || !invoiceIdPattern.test(id) || read().invoice?.id !== id) return new Response(null, { status: 204 });
  if (!await paypal.verifyWebhook(request.headers, event)) return json({ error: 'Invalid webhook signature.' }, 401);
  if (receipt.get(event.id)) return new Response(null, { status: 204 });
  const state = read();
  if (!state.scope || !state.invoice?.sent) return json({ error: 'Invoice send is still being recorded.' }, 503);
  const result = reconcile(await paypal.invoice(id), id, state.scope.version);
  db.transaction(() => {
    db.query('INSERT INTO webhook_receipt VALUES (?, ?, ?)').run(event.id, id, result.status);
    save({ ...state, deposit: { ...result, eventId: event.id } });
  })();
  return new Response(null, { status: 204 });
}

async function action(request: Request, name: string) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Expected an object.' }, 400);
  const state = read();
  if (name === 'contact') {
    if (state.invoice) throw new Error('The invoice already fixes the billing contact.');
    const email = field(body, 'email', 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid buyer email.');
    state.contact = { name: field(body, 'name'), email, organization: field(body, 'organization') };
    save(state);
    return json(snapshot(state));
  }
  if (name === 'scope') {
    if (state.review) throw new Error('This demo case already has a reviewed scope.');
    save({ contact: state.contact, scope: await draftScope(field(body, 'inquiry', 4000)) });
    return json(snapshot(read()));
  }
  if (!state.scope || body.version !== state.scope.version) return json({ error: 'Reload and review the current scope version.' }, 409);
  switch (name) {
    case 'review':
      if (state.review) throw new Error('This demo case already has a reviewed scope.');
      state.review = { repository: field(body, 'repository'), approver: field(body, 'approver'), ciBaseline: field(body, 'ciBaseline') };
      state.buyerToken = randomBytes(32).toString('hex');
      state.scope.version = 'scope-' + createHash('sha256').update(JSON.stringify([state.scope.version, state.review])).digest('hex').slice(0, 32);
      break;
    case 'access':
      if (!state.acceptance) throw new Error('Record buyer acceptance first.');
      state.access = field(body, 'receipt');
      break;
    case 'draft': {
      if (!state.acceptance || !paypal || state.invoice?.id) throw new Error('Accept the scope and configure PayPal before creating a draft.');
      const email = field(body, 'email', 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a sandbox buyer email.');
      state.invoice ??= { requestId: randomBytes(12).toString('hex'), email };
      if (state.invoice.email !== email) throw new Error('Retry using the original sandbox buyer email.');
      save(state);
      state.invoice.id = await paypal.draft(email, state.scope.version, state.invoice.requestId);
      break;
    }
    case 'send': {
      if (!state.invoice?.id || !paypal) throw new Error('Create a PayPal draft first.');
      const id = state.invoice.id;
      const draft = await paypal.invoice(id);
      reconcile(draft, id, state.scope.version);
      if (!state.invoice.sent && draft.status === 'DRAFT') await paypal.send(id);
      const invoice = await paypal.invoice(id);
      reconcile(invoice, id, state.scope.version);
      if (!['SHARED', 'SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING', 'PAID'].includes(invoice.status)) {
        throw new Error('PayPal has not made the invoice payable. Retry after checking the invoice.');
      }
      state.invoice.sent = true;
      state.invoice.link = shareLink(invoice.detail?.metadata?.recipient_view_url);
      break;
    }
    default: return json({ error: 'Unknown action.' }, 404);
  }
  save(state);
  return json(snapshot(state));
}

function pageResponse(body: string) {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' },
  });
}

async function buyer(request: Request) {
  const state = read();
  const token = Buffer.from(request.headers.get('X-Demo-Buyer') ?? '');
  if (!state.scope || !state.review || !state.buyerToken || token.length !== state.buyerToken.length ||
      !timingSafeEqual(token, Buffer.from(state.buyerToken))) return json({ error: 'This scope link is invalid.' }, 403);
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (body?.version !== state.scope.version) return json({ error: 'Review the current scope before accepting.' }, 409);
    if (!state.acceptance) {
      state.acceptance = { version: state.scope.version, receipt: 'buyer-demo:' + randomBytes(12).toString('hex') };
      save(state);
    }
  }
  return json({
    version: state.scope.version, work: state.scope.work, review: state.review,
    accepted: state.acceptance?.version === state.scope.version,
  });
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.DEMO_PORT ?? 4178),
  maxRequestBodySize: 64 * 1024,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.headers.get('Host') !== '127.0.0.1:' + server.port) return json({ error: 'Use the local operator address.' }, 403);
    if (pathname === '/workflow.css' && request.method === 'GET') {
      return new Response(workflowCss as unknown as string, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
    }
    if (pathname === '/' && request.method === 'GET') return pageResponse(page.replace('__OPERATOR__', operator));
    if (pathname === '/help' && request.method === 'GET') return pageResponse(helpHtml as unknown as string);
    if (pathname === '/buyer' && request.method === 'GET') return pageResponse(buyerHtml as unknown as string);
    if (pathname === '/buyer/scope') {
      if (request.method === 'GET') return buyer(request);
      if (request.method === 'POST') return exclusive(() => buyer(request)).catch(() => json({ error: 'Acceptance could not be saved.' }, 503));
    }
    const provided = Buffer.from(request.headers.get('X-Demo-Operator') ?? '');
    if (provided.length !== operator.length || !timingSafeEqual(provided, Buffer.from(operator))) return json({ error: 'Reload the operator screen.' }, 403);
    if (pathname === '/state' && request.method === 'GET') return json(snapshot(read()));
    if (request.method === 'POST' && pathname.startsWith('/actions/')) {
      return exclusive(() => action(request, pathname.slice('/actions/'.length))).catch(error =>
        json({ error: error instanceof Error && !('code' in error) ? error.message : 'Action failed. Check the local service and retry.' }, 400));
    }
    return json({ error: 'Not found.' }, 404);
  },
});
console.log('Scope to deposit at http://127.0.0.1:' + server.port);

const webhookPort = process.env.DEMO_WEBHOOK_PORT;
if (webhookPort) {
  const listener = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(webhookPort),
    maxRequestBodySize: 64 * 1024,
    fetch(request) {
      if (new URL(request.url).pathname !== '/webhooks/paypal' || request.method !== 'POST') {
        return json({ error: 'Not found.' }, 404);
      }
      return exclusive(() => webhook(request)).catch(() => json({ error: 'Webhook processing failed. Retry delivery.' }, 503));
    },
  });
  console.log('PayPal webhook receiver at http://127.0.0.1:' + listener.port + '/webhooks/paypal');
}

import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SQL } from 'bun';
import { project } from '../model.ts';
import service from './service.ts';
import { createApp } from '../demo/app.ts';
import { postgresStore } from '../demo/store.ts';
import { sandbox } from '../demo/paypal.ts';
const maxEvents = 2000;
const maxBatch = 100;
const allowedKeys: Record<string, readonly string[]> = {
    nominate: ['id', 'kind', 'account', 'method', 'ref'],
    review: ['id', 'kind', 'account', 'result', 'ref'],
    proof: ['id', 'kind', 'account', 'stage', 'ref', 'basis', 'invoiceId', 'payment'],
    check: ['id', 'kind', 'target', 'ref'],
    invalidate: ['id', 'kind', 'target', 'ref'],
};
const paymentKeys = ['invoiceId', 'paymentId', 'cents', 'currency', 'status'];
const opaqueId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const opaqueRef = /^[A-Za-z][A-Za-z0-9_-]{0,23}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,150}$/;
const digest = (value: string) => createHash('sha256').update(value).digest();
type Ledger = 'pilot' | 'smoke';
type Row = {
    event_id: string;
    body: Record<string, unknown>;
};
type Input = Record<string, unknown> & {
    id: string;
};
function json(value: unknown, status = 200) {
    return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validEvent(value: unknown): value is Input {
    if (!object(value) || typeof value.kind !== 'string' || !Object.hasOwn(allowedKeys, value.kind))
        return false;
    if (typeof value.id !== 'string' || !opaqueId.test(value.id) || typeof value.ref !== 'string' || !opaqueRef.test(value.ref))
        return false;
    if (Object.keys(value).some(key => !allowedKeys[value.kind as string].includes(key)))
        return false;
    for (const key of ['account', 'basis', 'target', 'invoiceId']) {
        if (key === 'basis' && value[key] === null)
            continue;
        if (key in value && (typeof value[key] !== 'string' || !opaqueId.test(value[key] as string)))
            return false;
    }
    if ('payment' in value) {
        const payment = value.payment;
        if (!object(payment) || Object.keys(payment).some(key => !paymentKeys.includes(key)))
            return false;
        for (const key of ['invoiceId', 'paymentId', 'currency', 'status']) {
            if (typeof payment[key] !== 'string' || !opaqueId.test(payment[key] as string))
                return false;
        }
    }
    return true;
}
const token = service.input().token.expose();
if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('SALES_PILOT_TOKEN must be a 256-bit hex token');
const expected = digest(`Bearer ${token}`);
const sql = new SQL({ url: service.load().db.url, max: 2, idleTimeout: 10, prepare: false });
async function initialize() {
    await sql.begin(async (tx) => {
        await tx `SELECT pg_advisory_xact_lock(832105, 0)`;
        await tx `CREATE TABLE IF NOT EXISTS sales_pilot_events_v1 (
      sequence integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      ledger text NOT NULL CHECK (ledger IN ('pilot', 'smoke')),
      event_id text NOT NULL,
      body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND body->>'id' IS NOT DISTINCT FROM event_id),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (ledger, event_id)
    )`;
        await tx `CREATE INDEX IF NOT EXISTS sales_pilot_events_v1_order ON sales_pilot_events_v1 (ledger, sequence)`;
    });
}
async function append(ledger: Ledger, batch: Input[]) {
    return sql.begin(async (tx) => {
        await tx `SET LOCAL lock_timeout = '5s'`;
        await tx `SET LOCAL statement_timeout = '10s'`;
        // One transaction at a time per ledger. Validate the whole proposed log before inserting.
        await tx `SELECT pg_advisory_xact_lock(832105, ${ledger === 'pilot' ? 1 : 2}::integer)`;
        const rows: Row[] = await tx `SELECT event_id, body FROM sales_pilot_events_v1 WHERE ledger = ${ledger} ORDER BY sequence`;
        const byId = new Map(rows.map(row => [row.event_id, row.body]));
        const added: Input[] = [];
        for (const event of batch) {
            const prior = byId.get(event.id);
            if (prior) {
                if (!isDeepStrictEqual(prior, event))
                    return json({ error: 'event_id_conflict' }, 409);
                continue;
            }
            byId.set(event.id, event);
            added.push(event);
        }
        if (byId.size > maxEvents)
            return json({ error: 'ledger_limit' }, 409);
        let projection;
        try {
            projection = project([...byId.values()]);
        }
        catch {
            return json({ error: 'invalid_event_sequence' }, 422);
        }
        for (const event of added) {
            await tx `INSERT INTO sales_pilot_events_v1 (ledger, event_id, body) VALUES (${ledger}, ${event.id}, ${JSON.stringify(event)}::jsonb)`;
        }
        return json({ appended: added.length, projection }, added.length ? 201 : 200);
    });
}
try {
    await initialize();
}
catch {
    throw new Error('Sales pilot database initialization failed');
}
const input = service.input();
const workflow = createApp({ store: await postgresStore(sql), operator: token, publicOrigin: service.origin(), draft: service.origin().startsWith('http://localhost:') ? undefined : async () => { throw new Error('Use the local operator app with Ollama to draft this scope. Its reviewed evidence is saved here in Prisma.'); }, paypal: input.paypalClientId && input.paypalSecret && input.paypalWebhookId ? sandbox({ clientId: input.paypalClientId.expose(), secret: input.paypalSecret.expose(), webhookId: input.paypalWebhookId }) : undefined });
Bun.serve({
    hostname: '0.0.0.0',
    port: service.port(),
    maxRequestBodySize: 128 * 1024,
    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/healthz' && request.method === 'GET')
            return json({ ok: true, service: 'sales-pilot', api: 1 });
        if (!url.pathname.startsWith('/v1/'))
            return workflow(request);
        const authorization = request.headers.get('Authorization') ?? '';
        if (authorization.length !== 71 || !timingSafeEqual(digest(authorization), expected))
            return json({ error: 'unauthorized' }, 401);
        const match = /^\/v1\/(pilot|smoke)\/(projection|events)$/.exec(url.pathname);
        if (!match)
            return json({ error: 'not_found' }, 404);
        const ledger = match[1] as Ledger;
        try {
            if (match[2] === 'projection' && request.method === 'GET') {
                const cutoff = url.searchParams.get('through');
                if (cutoff !== null && !/^\d{1,4}$/.test(cutoff))
                    return json({ error: 'invalid_cutoff' }, 400);
                const rows: Row[] = await sql `SELECT event_id, body FROM sales_pilot_events_v1 WHERE ledger = ${ledger} ORDER BY sequence`;
                const through = cutoff === null ? rows.length : Number(cutoff);
                if (through > rows.length)
                    return json({ error: 'invalid_cutoff' }, 400);
                return json(project(rows.map(row => row.body), through));
            }
            if (match[2] === 'events' && request.method === 'POST') {
                if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json')
                    return json({ error: 'expected_json' }, 415);
                const body: unknown = await request.json().catch(() => null);
                if (!Array.isArray(body) || body.length < 1 || body.length > maxBatch || !body.every(validEvent))
                    return json({ error: 'invalid_event_batch' }, 400);
                return await append(ledger, body);
            }
            return json({ error: 'method_not_allowed' }, 405);
        }
        catch {
            return json({ error: 'storage_unavailable' }, 503);
        }
    },
});

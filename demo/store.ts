import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import type { draftScope } from './scope.ts';
import type { reconcile } from './paypal.ts';
export type Engagement = {
    id: string;
    contact?: {
        name: string;
        email: string;
        organization: string;
    };
    scope?: Awaited<ReturnType<typeof draftScope>>;
    review?: {
        repository: string;
        approver: string;
        ciBaseline: string;
        nextStep: string;
        contactPoint: string;
    };
    buyerToken?: string;
    acceptance?: {
        version: string;
        receipt: string;
        at: string;
        buyer: string;
    };
    invoice?: {
        requestId: string;
        email: string;
        id?: string;
        sent?: boolean;
        link?: string;
        deliveredAt?: string;
    };
    access?: string;
    deposit?: ReturnType<typeof reconcile> & {
        eventId: string;
        verifiedAt: string;
    };
    kickoff?: {
        at: string;
        receipt: string;
        paymentEvent: string;
        paymentReceipt: { invoiceId: string; paymentIds: string[]; cents: number; currency: string; verifiedAt: string };
        nextStep: string;
        contactPoint: string;
    };
};
export type Evidence = {
    previous: string | null;
    id: string;
    sequence: number;
    at: string;
    kind: string;
    actor: string;
    body: Record<string, unknown>;
};
export type Context = {
    state: Engagement;
    events: Evidence[];
    emit(kind: string, actor: string, body: Record<string, unknown>): Evidence;
};
export interface Store {
    kind: 'SQLite' | 'Prisma Postgres';
    run<T>(fn: (context: Context) => Promise<T>): Promise<T>;
}
function context(state: Engagement, events: Evidence[]): Context {
    return { state, events, emit(kind, actor, body) {
            const event = { previous: events.at(-1)?.id ?? null, id: randomUUID(), sequence: events.length + 1, at: new Date().toISOString(), kind, actor, body };
            events.push(event);
            return event;
        } };
}
export function sqliteStore(path: string): Store {
    const db = new Database(path);
    db.exec(`CREATE TABLE IF NOT EXISTS engagement_v1 (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS engagement_events_v1 (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL);`);
    db.query('INSERT OR IGNORE INTO engagement_v1 VALUES (1, ?)').run(JSON.stringify({ id: randomUUID() }));
    let queue: Promise<unknown> = Promise.resolve();
    return { kind: 'SQLite', run<T>(fn: (ctx: Context) => Promise<T>) {
            const task = queue.then(async () => {
                const state = JSON.parse(db.query<{
                    body: string;
                }, [
                ]>('SELECT body FROM engagement_v1 WHERE id=1').get()!.body);
                const events = db.query<{
                    body: string;
                }, [
                ]>('SELECT body FROM engagement_events_v1 ORDER BY sequence').all().map(row => JSON.parse(row.body));
                const count = events.length;
                const ctx = context(state, events);
                const result = await fn(ctx);
                db.transaction(() => {
                    db.query('UPDATE engagement_v1 SET body=? WHERE id=1').run(JSON.stringify(ctx.state));
                    for (const event of events.slice(count))
                        db.query('INSERT INTO engagement_events_v1 VALUES (?,?)').run(event.sequence, JSON.stringify(event));
                })();
                return result;
            });
            queue = task.catch(() => { });
            return task;
        } };
}
export async function postgresStore(sql: SQL): Promise<Store> {
    await sql.begin(async (tx) => {
        await tx `SELECT pg_advisory_xact_lock(832106,0)`;
        await tx `CREATE TABLE IF NOT EXISTS engagement_v1 (id integer PRIMARY KEY CHECK(id=1), body jsonb NOT NULL)`;
        await tx `CREATE TABLE IF NOT EXISTS engagement_events_v1 (sequence integer PRIMARY KEY, event_id text UNIQUE NOT NULL, recorded_at timestamptz NOT NULL, body jsonb NOT NULL)`;
        await tx `INSERT INTO engagement_v1 VALUES (1, ${JSON.stringify({ id: randomUUID() })}::jsonb) ON CONFLICT DO NOTHING`;
    });
    return { kind: 'Prisma Postgres', async run<T>(fn: (ctx: Context) => Promise<T>) {
            return sql.begin(async (tx) => {
                await tx `SET LOCAL lock_timeout = '5s'`;
                const [row] = await tx `SELECT body FROM engagement_v1 WHERE id=1 FOR UPDATE`;
                const rows = await tx `SELECT body FROM engagement_events_v1 ORDER BY sequence`;
                const events = rows.map((row: {
                    body: Evidence;
                }) => row.body);
                const count = events.length;
                const ctx = context(row.body, events);
                const result = await fn(ctx);
                await tx `UPDATE engagement_v1 SET body=${JSON.stringify(ctx.state)}::jsonb WHERE id=1`;
                for (const event of events.slice(count))
                    await tx `INSERT INTO engagement_events_v1 VALUES (${event.sequence},${event.id},${event.at}::timestamptz,${JSON.stringify(event)}::jsonb)`;
                return result;
            });
        } };
}

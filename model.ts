import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const stages = [
  'conversation', 'qualified', 'proposed', 'scope-accepted', 'deposit-invoiced',
  'deposit-verified', 'kicked-off', 'handoff-accepted', 'balance-invoiced', 'balance-verified',
] as const;
const methods = ['warm-intro', 'partner-referral', 'public-request'] as const;
type Stage = typeof stages[number];
type Method = typeof methods[number];
type Base = { id: string };
type Payment = { invoiceId: string; paymentId: string; cents: number; currency: string; status: 'settled' | 'pending' | 'partial' };
type Proof = Base & { kind: 'proof'; account: string; stage: Stage; ref: string; basis: string | null; invoiceId?: string; payment?: Payment };
type Event = Proof
  | (Base & { kind: 'nominate'; account: string; method: Method; ref: string })
  | (Base & { kind: 'review'; account: string; result: 'fit' | 'not-fit' | 'abstain'; ref: string })
  | (Base & { kind: 'check' | 'invalidate'; target: string; ref: string });

const isText = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const has = <T extends string>(values: readonly T[], x: unknown): x is T => values.some(value => value === x);

function parseEvent(value: unknown): Event {
  if (!isObject(value) || !isText(value.id) || !isText(value.ref)) throw new Error('event needs id and evidence reference');
  const { kind, account, stage, basis, payment } = value;
  if (kind === 'check' || kind === 'invalidate') {
    if (!isText(value.target)) throw new Error(`${value.id}: missing target`);
  } else {
    if (!isText(account)) throw new Error(`${value.id}: missing account`);
    if (kind === 'nominate') {
      if (!has(methods, value.method)) throw new Error(`${value.id}: unknown discovery method`);
    } else if (kind === 'review') {
      if (!has(['fit', 'not-fit', 'abstain'], value.result)) throw new Error(`${value.id}: invalid review result`);
    } else if (kind === 'proof') {
      if (!has(stages, stage) || !(basis === null || isText(basis))) throw new Error(`${value.id}: invalid stage or basis`);
      if ((stage === 'deposit-invoiced' || stage === 'balance-invoiced') && !isText(value.invoiceId)) throw new Error(`${value.id}: missing invoice ID`);
      if (stage === 'deposit-verified' || stage === 'balance-verified') {
        if (!isObject(payment) || !isText(payment.invoiceId) || !isText(payment.paymentId) || !isText(payment.currency) ||
            typeof payment.cents !== 'number' || !Number.isSafeInteger(payment.cents) || payment.cents < 0 ||
            !has(['settled', 'pending', 'partial'], payment.status)) throw new Error(`${value.id}: invalid payment evidence`);
      } else if (payment !== undefined) throw new Error(`${value.id}: payment evidence on nonpayment stage`);
    } else throw new Error(`${value.id}: unknown event kind`);
  }
  return value as Event;
}

/** Local evidence projection. A check is an operator attestation, not an authenticated provider fetch. */
export function project(input: readonly unknown[], through = input.length) {
  if (!Number.isSafeInteger(through) || through < 0 || through > input.length) throw new Error('invalid replay cutoff');
  const log = new Map<string, Event>();
  const checks = new Set<string>();
  const invalidated = new Set<string>();
  const accounts = new Set<string>();
  const paymentOwners = new Map<string, string>();
  const invoiceOwners = new Map<string, string>();
  for (const raw of input.slice(0, through)) {
    const event = parseEvent(raw);
    if (log.has(event.id)) {
      if (!isDeepStrictEqual(log.get(event.id), event)) throw new Error(`${event.id}: conflicting retry`);
      continue;
    }
    if (event.kind === 'check' || event.kind === 'invalidate') {
      const target = log.get(event.target);
      if (target?.kind !== 'proof' && target?.kind !== 'review') throw new Error(`${event.id}: target must be an earlier proof or review`);
      if (event.kind === 'check') {
        if (invalidated.has(target.id)) throw new Error(`${event.id}: submit a new receipt after invalidation`);
        if (target.kind === 'proof' && target.invoiceId && (target.stage === 'deposit-invoiced' || target.stage === 'balance-invoiced')) {
          const owner = JSON.stringify([target.account, target.stage]);
          const prior = invoiceOwners.get(target.invoiceId);
          if (prior && prior !== owner) throw new Error(`${event.id}: invoice already assigned to another stage or opportunity`);
          invoiceOwners.set(target.invoiceId, owner);
        }
        if (target.kind === 'proof' && target.payment) {
          const owner = JSON.stringify([target.account, target.stage, target.payment.invoiceId]);
          const prior = paymentOwners.get(target.payment.paymentId);
          if (prior && prior !== owner) throw new Error(`${event.id}: payment already assigned to another invoice or opportunity`);
          paymentOwners.set(target.payment.paymentId, owner);
        }
        checks.add(target.id);
      } else invalidated.add(target.id);
    } else if ('account' in event) {
      accounts.add(event.account);
      if (event.kind === 'proof') {
        const previous = stages[stages.indexOf(event.stage) - 1];
        if (previous) {
          const basis = event.basis === null ? undefined : log.get(event.basis);
          if (basis?.kind !== 'proof' || basis.account !== event.account || basis.stage !== previous) {
            throw new Error(`${event.id}: basis must be the prior stage receipt for this account`);
          }
        } else if (event.basis !== null) throw new Error(`${event.id}: initial receipt cannot have a basis`);
      }
    }
    log.set(event.id, event);
  }

  const events = [...log.values()];
  const nominationsByAccount = new Map<string, Set<Method>>();
  for (const e of events) if (e.kind === 'nominate') {
    const existing = nominationsByAccount.get(e.account) ?? new Set<Method>();
    existing.add(e.method);
    nominationsByAccount.set(e.account, existing);
  }
  const reviews = new Map<string, 'fit' | 'not-fit' | 'abstain'>();
  for (const e of events) if (e.kind === 'review' && checks.has(e.id)) {
    if (invalidated.has(e.id)) reviews.delete(e.account);
    else reviews.set(e.account, e.result);
  }
  const nominations = methods.map(method => {
    const outcomes = { fit: 0, 'not-fit': 0, abstain: 0, unreviewed: 0 };
    for (const [account, nominations] of nominationsByAccount) {
      if (nominations.has(method)) outcomes[reviews.get(account) ?? 'unreviewed']++;
    }
    return { method, nominatedAccounts: Object.values(outcomes).reduce((sum, count) => sum + count, 0), ...outcomes };
  });

  const opportunities = [...accounts].map(account => {
    let prior: Proof | undefined;
    const receipts: Partial<Record<Stage, string>> = {};
    let waitingFor: Stage | null = null;
    for (const stage of stages) {
      const basis = prior?.id ?? null;
      const candidate = events.findLast((e): e is Proof => e.kind === 'proof' && e.account === account && e.stage === stage && e.basis === basis && checks.has(e.id));
      const payment = candidate?.payment;
      // A checked partial or pending receipt can be true while failing the business gate.
      const paymentEligible = payment?.status === 'settled' && payment.cents === 62500 && payment.currency === 'USD' && payment.invoiceId === prior?.invoiceId;
      if (!candidate || invalidated.has(candidate.id) || ((stage === 'deposit-verified' || stage === 'balance-verified') && !paymentEligible)) {
        waitingFor = stage;
        break;
      }
      receipts[stage] = candidate.id;
      prior = candidate;
    }
    return { account, nominatedBy: [...(nominationsByAccount.get(account) ?? [])], stage: prior?.stage ?? 'candidate', waitingFor, receipts };
  });
  return { through, uniqueEvents: events.length, uniqueAccounts: accounts.size, nominations, opportunities };
}

export function readTrace(path: string): unknown[] {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
}

if (import.meta.main) {
  const [, , path, cutoff] = process.argv;
  if (!path) throw new Error('Usage: node model.ts TRACE.jsonl [EVENT_COUNT]');
  console.log(JSON.stringify(project(readTrace(path), cutoff === undefined ? undefined : Number(cutoff)), null, 2));
}

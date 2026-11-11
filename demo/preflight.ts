import { sandbox } from './paypal.ts';

const clientId = process.env.PAYPAL_SANDBOX_CLIENT_ID;
const secret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
const webhookId = process.env.PAYPAL_SANDBOX_WEBHOOK_ID;
const required = ['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.REFUNDED', 'INVOICING.INVOICE.CANCELLED'];

try {
  if (!clientId || !secret || !webhookId) {
    throw new Error('Set PAYPAL_SANDBOX_CLIENT_ID, PAYPAL_SANDBOX_CLIENT_SECRET and PAYPAL_SANDBOX_WEBHOOK_ID locally.');
  }
  const expected = new URL(process.argv[2] ?? '');
  if (expected.protocol !== 'https:' || expected.pathname !== '/webhooks/paypal' ||
      expected.username || expected.password || expected.search || expected.hash) {
    throw new Error('Pass the exact HTTPS /webhooks/paypal URL registered with PayPal Sandbox.');
  }
  const registration = await sandbox({ clientId, secret, webhookId }).registration();
  if (registration.id !== webhookId || registration.url !== expected.href) {
    throw new Error('PayPal registered a different webhook ID or URL.');
  }
  const subscribed = registration.event_types?.map(event => event.name) ?? [];
  const missing = required.filter(event => !subscribed.includes(event));
  if (missing.length) throw new Error('PayPal webhook subscriptions missing: ' + missing.join(', '));
  const response = await fetch(expected, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (response.status !== 400 || (await response.json()).error !== 'Invalid event.') {
    throw new Error('HTTPS webhook did not return the expected response to an empty event.');
  }
  console.log('Sandbox credentials, webhook registration, subscriptions and HTTPS reachability verified.');
} catch (error) {
  console.error(error instanceof Error && error.message !== 'Invalid URL'
    ? error.message
    : 'Pass the exact HTTPS /webhooks/paypal URL registered with PayPal Sandbox.');
  process.exitCode = 1;
}

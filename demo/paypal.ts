const origin = 'https://api-m.sandbox.paypal.com';
export const depositCents = 62_500;
export const invoiceIdPattern = /^INV2-[A-Z0-9]+(?:-[A-Z0-9]+){3}$/;

type Money = { currency_code?: string; value?: string };
export type Invoice = {
  id: string;
  status: string;
  detail?: { reference?: string; metadata?: { recipient_view_url?: string } };
  amount?: Money;
  due_amount?: Money;
  payments?: {
    paid_amount?: Money;
    transactions?: { type?: string; payment_id?: string; amount?: Money }[];
  };
};

function usd(money?: Money) {
  if (money?.currency_code !== 'USD' || !money.value || !/^\d{1,8}(\.\d{1,2})?$/.test(money.value)) return null;
  const [dollars, cents = ''] = money.value.split('.');
  return Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
}

export function reconcile(invoice: Invoice, expectedId: string, scopeRef: string) {
  if (invoice.id !== expectedId || invoice.detail?.reference !== scopeRef || usd(invoice.amount) !== depositCents) {
    throw new Error('PayPal invoice does not match the approved scope and deposit.');
  }
  const paidCents = usd(invoice.payments?.paid_amount);
  const transactions = invoice.payments?.transactions;
  const payments = Array.isArray(transactions) ? transactions : [];
  const ids = new Set<string>();
  let providerTotal = 0;
  for (const payment of payments) {
    const amount = usd(payment?.amount);
    if (payment?.type !== 'PAYPAL' || !payment.payment_id || ids.has(payment.payment_id) || amount === null || amount <= 0) {
      providerTotal = -1;
      break;
    }
    ids.add(payment.payment_id);
    providerTotal += amount;
  }
  const settled = invoice.status === 'PAID' && paidCents === depositCents && providerTotal === depositCents &&
    (invoice.due_amount === undefined || usd(invoice.due_amount) === 0);
  return { status: invoice.status, paidCents, settled, paymentIds: settled ? [...ids].sort() : [] };
}

type Credentials = { clientId: string; secret: string; webhookId: string };

export function sandbox(config: Credentials, fetcher: typeof fetch = fetch) {
  async function request(path: string, options: RequestInit = {}) {
    const tokenResponse = await fetcher(origin + '/v1/oauth2/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(config.clientId + ':' + config.secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenResponse.ok) throw new Error('PayPal Sandbox authentication failed.');
    const { access_token } = await tokenResponse.json() as { access_token?: string };
    if (!access_token) throw new Error('PayPal Sandbox did not provide an access token.');
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Bearer ' + access_token);
    headers.set('Content-Type', 'application/json');
    const response = await fetcher(origin + path, {
      ...options, headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('PayPal Sandbox request failed (' + response.status + ').');
    return response;
  }

  const invoicePath = (id: string) => {
    if (!invoiceIdPattern.test(id)) throw new Error('Invalid PayPal invoice ID.');
    return '/v2/invoicing/invoices/' + id;
  };

  return {
    async draft(email: string, scopeRef: string, requestId: string) {
      const response = await request('/v2/invoicing/invoices', {
        method: 'POST',
        headers: { 'PayPal-Request-Id': requestId, Prefer: 'return=representation' },
        body: JSON.stringify({
          detail: { reference: scopeRef, invoice_number: requestId, currency_code: 'USD' },
          primary_recipients: [{ billing_info: { email_address: email } }],
          items: [{ name: 'GitHub Repository Hardening Sprint deposit', quantity: '1', unit_amount: { currency_code: 'USD', value: '625.00' } }],
          configuration: { partial_payment: { allow_partial_payment: true }, allow_tip: false },
        }),
      });
      const invoice = await response.json() as Invoice;
      if (!invoiceIdPattern.test(invoice.id)) throw new Error('PayPal did not return a draft invoice ID.');
      return invoice.id;
    },
    async send(id: string) {
      await request(invoicePath(id) + '/send', {
        method: 'POST',
        body: JSON.stringify({ send_to_recipient: false, send_to_invoicer: false }),
      });
    },
    async invoice(id: string) {
      const response = await request(invoicePath(id));
      return await response.json() as Invoice;
    },
    async registration() {
      if (!/^[A-Za-z0-9-]{1,120}$/.test(config.webhookId)) throw new Error('Invalid PayPal webhook ID.');
      const response = await request('/v1/notifications/webhooks/' + config.webhookId);
      return await response.json() as { id?: string; url?: string; event_types?: { name?: string }[] };
    },
    async verifyWebhook(headers: Headers, event: unknown) {
      const verification: Record<string, unknown> = { webhook_id: config.webhookId, webhook_event: event };
      for (const field of ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time']) {
        const value = headers.get('paypal-' + field.replaceAll('_', '-'));
        if (!value) return false;
        verification[field] = value;
      }
      const response = await request('/v1/notifications/verify-webhook-signature', {
        method: 'POST', body: JSON.stringify(verification),
      });
      const result = await response.json() as { verification_status?: string };
      return result.verification_status === 'SUCCESS';
    },
  };
}

import { module } from '@prisma/composer';
import { envSecret, envParam, rawPostgres } from '@prisma/composer-prisma-cloud';
import api from './service.ts';
export default module('hardening-sprint-sales-pilot', ({ provision }) => {
    const db = provision(rawPostgres({ name: 'sales-ledger' }), { id: 'ledger' });
    provision(api, { deps: { db }, input: { token: envSecret('SALES_PILOT_TOKEN'),
            ...(process.env.PAYPAL_SANDBOX_CLIENT_ID && process.env.PAYPAL_SANDBOX_WEBHOOK_ID ? { paypalClientId: envSecret('PAYPAL_SANDBOX_CLIENT_ID'), paypalSecret: envSecret('PAYPAL_SANDBOX_CLIENT_SECRET'), paypalWebhookId: envParam('PAYPAL_SANDBOX_WEBHOOK_ID') } : {}) } });
});

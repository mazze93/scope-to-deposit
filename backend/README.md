# Prisma Compute deployment

This directory is the deployable backend for Scope to Deposit. It preserves the original `/v1/pilot` and `/v1/smoke` ledger APIs and adds the operator workspace, buyer scope and confirmation, and PayPal Sandbox webhook receiver. Composer provisions the existing Compute service and Prisma Postgres database using the stable module and provision names.

Install the exact dependencies with `npm ci --ignore-scripts`. Then `npm run check` and `npm run build`. No database URL is committed: the service receives its Prisma Postgres connection through `service.load().db.url`.

## Local verification

Provide `SALES_PILOT_TOKEN` through an ignored owner-only environment file, then run `prisma dev --detach` with that environment loaded. The CLI prints the local service URL. Run `bun smoke.ts URL` with the same token for the existing ledger checks. Run `bun test` from the repository root for workflow and PayPal fixture checks.

The workflow uses separate `engagement_v1` and `engagement_events_v1` tables. Each transition locks the engagement row and commits the new state and evidence together. A retry cannot create a second acceptance, sent-invoice record, verified webhook record, or kickoff confirmation. Event records include a predecessor ID, sequence, timestamp, actor, and relevant evidence. SQL is parameterized. There are no application endpoints to delete or edit history. Database administrators still control the underlying database; this is not an independently witnessed tamper-proof log.

## Production

The existing module is `hardening-sprint-sales-pilot`, deployed in `us-east-1`. Before deploying, inspect `prisma auth whoami --json` and `prisma service version list` and record the current version as the rollback target. Build before running `prisma deploy`; the CLI does not build for you. The pinned CLI uses `--environment NAME` for an isolated preview; no environment flag deploys production.

Set these environment variables before deployment:

- `SALES_PILOT_TOKEN`: the existing 256-bit operator token.
- `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, `PAYPAL_SANDBOX_WEBHOOK_ID`: the Sandbox application and its registered webhook. Credentials use Composer secret inputs.

When the PayPal configuration is absent, the service runs with invoicing disabled. Register the exact deployed `/webhooks/paypal` URL for `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.REFUNDED`, and `INVOICING.INVOICE.CANCELLED`, then redeploy with the registration ID and run the [preflight](../demo/preflight.ts). Do not create a new database or rename the module to deploy an update.

The hosted workspace requires the operator token at `/login`; it establishes an eight-hour HttpOnly, Secure, SameSite=Strict session. The token is never embedded in the hosted HTML. Buyer access uses a random capability in the URL fragment, sent in a request header. Treat those links as private. Responses are not cached and HTML carries a nonce-based CSP and same-origin referrer policy.

AI can run on the operator's local Ollama instance. Set `SALES_PILOT_URL` and `SALES_PILOT_TOKEN` in the local app environment. The local server sends the model output to Prisma, which validates the structure and exact source quotes and records its provenance as operator-submitted local AI output. All other state, buyer, payment, and kickoff operations run on Prisma. Hosted model inference is not configured in this version.

Invoice delivery evidence means the PayPal send operation was accepted and the invoice is payable. It does not prove inbox delivery or that a recipient read it. A buyer acceptance proves possession of the private link, not independently verified identity. Use synthetic records and Sandbox accounts for the hackathon.

Rollback changes the deployed service version, preserving the additive tables and existing ledger data. The original pre-workflow version was `cpv_mmp7otryl5rj727di9tqty3m`; inspect live state before choosing a rollback target.

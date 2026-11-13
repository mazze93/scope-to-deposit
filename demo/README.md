# Run Scope to Deposit

Scope to Deposit carries one synthetic consulting engagement from contact through reviewed scope, buyer acceptance, invoice delivery, verified deposit, and kickoff confirmation. The example is a $1,250 GitHub Repository Hardening Sprint with a $625 USD deposit.

## Local operator with Prisma backend

1. Install Bun and Ollama. Install `llama3.1:8b`, then start it with `OLLAMA_HOST=127.0.0.1:11435 ollama serve`.
2. Configure and deploy the [Prisma backend](../backend/README.md). Register its `/webhooks/paypal` route with your PayPal Sandbox app. Run `bun preflight.ts YOUR_HTTPS_WEBHOOK_URL` with the Sandbox credentials and webhook ID loaded.
3. In this directory, create an ignored `.env.local` with `SALES_PILOT_URL` set to the deployed HTTPS origin and `SALES_PILOT_TOKEN` set to the private operator token. Restrict the file to its owner with `chmod 600 .env.local`. Never paste tokens into issues or commit them.
4. Run `bun server.ts` and open `http://127.0.0.1:4178`. This local operator screen runs AI drafting through Ollama. It sends the draft and inquiry to your Prisma backend, which validates exact source quotes and persists the engagement and evidence. All subsequent actions also use Prisma. The buyer link points to the hosted service.
5. Capture the synthetic buyer's name, organization, and PayPal Sandbox email. Draft the scope, review its evidence, and supply the repository, approver, CI baseline, agreed next step, and contact point. Approve that version.
6. Open the buyer link, review the exact work and next step, and accept it as the synthetic buyer. Back in the operator screen, create the invoice and approve sending it through PayPal.
7. Pay $250 with the Sandbox buyer. A verified webhook should leave kickoff on hold. Pay the remaining $375. Once the app verifies the full $625 and you confirm repository access, confirm kickoff.
8. Inspect the buyer confirmation and event history: buyer, accepted scope, invoice and payment IDs, agreed next step, and contact point must agree.

The backend sends Sandbox invoices to the saved recipient through PayPal. Its send receipt proves that PayPal accepted the send operation, not inbox delivery. Acceptance is tied to possession of a version-bound link, not verified identity. The UI's evidence history identifies operator attestations, local AI output, buyer acceptance, and provider-verified payment separately.

## Standalone local development

Omit `SALES_PILOT_URL` to use local SQLite (`engagement.sqlite`, or `DEMO_DB`). This is a separate state store, not Prisma. The prior demo's `demo.sqlite` file is left untouched. To receive webhooks locally, set `DEMO_WEBHOOK_PORT=4185` and expose only that listener through an HTTPS tunnel. Keep the operator port on loopback. Configure the three `PAYPAL_SANDBOX_*` variables from `.env.example` and register the tunnel's `/webhooks/paypal` URL.

Run `bun test` from the repository root. Tests use synthetic provider fixtures and do not constitute a completed PayPal Sandbox payment. Full payment opens kickoff only when the matching invoice and accepted scope report exactly $625 USD in distinct PayPal transactions with `PAID` status. Partial, pending, manually marked paid, and refunded states stay on hold. Duplicate webhooks do not add events twice; refunds preserve history and suspend the current readiness decision.

The six folding sheets are keyboard-operable and respect reduced motion. The divider gauge tracks persisted requirements separately from the currently open sheet. Help, source, and the current license are linked in the footer. MIT remains the published license pending the owner's licensing review.

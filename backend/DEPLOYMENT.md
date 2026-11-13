# Verified deployment — 2026-11-12

Source commit: `5fcf58f5fc6ecc4c5a396c197b29854e27f98a8c`.

The workflow was deployed at approximately 8:00 p.m. Eastern on November 12, 2026, after the hackathon deadline. No hackathon entry or public demo video was submitted. The [Devpost event page](https://paypalaihackathon.devpost.com/) reported that the event had ended when checked.

Production service: https://ptgf12v9ztig0fmg9atzrb1w.ewr.prisma.build

- Prisma Compute: `cps_ptgf12v9ztig0fmg9atzrb1w`
- Running service version: `cpv_tn2xq94v0jjpjlzet5p5zf5y`
- Existing Prisma Postgres database: `db_ghinz17vd7ul2v4pgrlfl4u0`
- Deploy report retained outside the public repository at the Revenue project's `hardening-sprint/release/scope-to-deposit/prisma-workflow-deploy.json`.

## Verified against the deployed service

- Health returns HTTP 200.
- Anonymous operator root redirects to the HTTPS login page; anonymous state returns 401.
- Operator sign-in returns 303 and establishes a Secure, HttpOnly, SameSite=Strict cookie.
- The authenticated operator page returns 200, includes all six stages, and does not embed the private operator token.
- Hosted login and buyer HTML carry the nonce-based content security policy.
- An invalid buyer capability returns 403; an empty PayPal webhook returns 400.
- Authenticated state identifies its storage as Prisma Postgres and initially contains zero engagement events.
- The existing ledger HTTP smoke passes health, authentication, concurrent retry, atomic rejection, payment gates, historical replay, and ledger isolation.

## Initial outstanding evidence and configuration (superseded by the update below)

PayPal configuration is disabled in this deployed version. The user approved saving the existing Scope to Deposit Sandbox credentials locally and supplying them as Prisma secret inputs, but the credential transfer has not succeeded. The previously linked Chrome tab is no longer present, and the connector currently fails to create new tabs. A reopened app tab is needed to continue that transfer without printing credentials.

There is no registered, verified production webhook, no actual Sandbox invoice/payment demonstration, and no completed public video. The 12 local tests use synthetic payment fixtures; they do not prove provider integration. AI has been exercised locally with Ollama and local Prisma Postgres; the hosted service supports receiving validated local-model output through the local operator app. Hosted model inference is not configured.

Deployment is a verified milestone, not completion of the end-to-end product or hackathon objective. Keep this distinction when preparing public claims or demo materials.


## Update — PayPal enabled and real invoice sent

The user restored the Sandbox session and the existing app credentials passed a real PayPal OAuth request. Credentials are stored in ignored owner-only local configuration and supplied to Prisma as Composer secret inputs. No credential values are committed.

Webhook `0HH57733DW815913J` is registered to the deployed `/webhooks/paypal` endpoint for invoice paid, refunded, and cancelled events. The preflight verified the credentials, exact registration URL and ID, all three subscriptions, and the endpoint's expected rejection of an empty event.

Source commit `9d5802f` was deployed with PayPal enabled. Two defects were corrected during real integration: browser form navigation needs a same-origin referrer policy for its origin check, and PayPal requires the invoice number to contain fewer than 25 characters. The full idempotency key is retained while the invoice number uses 24 characters.

A real local Ollama draft was saved into hosted Prisma Postgres. Its inquiry quote identifies the repository and current CI baseline; the absent approver was resolved during review. The synthetic buyer accepted scope `scope-56265ecbf45179905be05cd62e4adcad` through the hosted page. PayPal created and sent Sandbox invoice `INV2-8QE7-U28H-42AQ-ZBA4` for $625 USD. Prisma holds seven transitions through a clearly labeled synthetic access attestation. No real repository access was granted.

A fresh PayPal invoice fetch returned `SENT`, with no settled payment. The partial-payment sheet is set to $250, but the provider popup is not exposed by the browser connector. The user was asked to complete that Sandbox payment and leave the remaining $375 unpaid so that the on-hold state can be verified. No actual payment or verified payment webhook is claimed yet.

The sanitized provider check is retained in the Revenue release directory as `paypal-sent-invoice-evidence.json`. It excludes credentials and the buyer capability. The public video and hackathon entry remain incomplete; the deadline was missed.

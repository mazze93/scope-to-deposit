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

## Outstanding evidence and configuration

PayPal configuration is disabled in this deployed version. The user approved saving the existing Scope to Deposit Sandbox credentials locally and supplying them as Prisma secret inputs, but the credential transfer has not succeeded. The previously linked Chrome tab is no longer present, and the connector currently fails to create new tabs. A reopened app tab is needed to continue that transfer without printing credentials.

There is no registered, verified production webhook, no actual Sandbox invoice/payment demonstration, and no completed public video. The 12 local tests use synthetic payment fixtures; they do not prove provider integration. AI has been exercised locally with Ollama and local Prisma Postgres; the hosted service supports receiving validated local-model output through the local operator app. Hosted model inference is not configured.

Deployment is a verified milestone, not completion of the end-to-end product or hackathon objective. Keep this distinction when preparing public claims or demo materials.

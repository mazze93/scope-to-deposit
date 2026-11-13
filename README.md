# Scope to Deposit

Has this client accepted the work and paid the deposit, so I can schedule kickoff?

Scope to Deposit carries one consulting engagement through **contact → reviewed scope → buyer acceptance → invoice delivery → verified payment → kickoff confirmation**. The first use case is a $1,250 GitHub Repository Hardening Sprint with a $625 USD PayPal Sandbox deposit.

AI drafts up to three proposed tasks, quotes the inquiry, and flags missing repository, approver, and CI facts. The operator resolves the missing facts and records the next step and contact point. The buyer accepts that exact version. PayPal creates and sends the deposit invoice; the backend verifies signed events and independently fetches the invoice before deciding whether payment satisfies the gate. Partial or pending payment does not open kickoff.

The confirmation shows the buyer, accepted work, payment IDs, next step, and contact point. Prisma Compute serves the workflow and buyer pages; Prisma Postgres atomically preserves each transition and its evidence. The origami-inspired sheets expose all six stages, with a separate progress gauge and inspectable decision history.

- [Run the local AI operator](demo/README.md)
- [Deploy and verify the Prisma backend](backend/README.md)
- [Current license](LICENSE) — MIT; licensing options remain under owner review.

Run `bun test` for the decision, workflow, transaction, and payment-fixture tests. The PayPal fixtures are synthetic, not proof of a completed provider payment. AI currently runs through local Ollama connected to the hosted backend; hosted inference is not configured. Use synthetic client records and PayPal Sandbox accounts.

Stratum and Checkmate informed the decision and evidence model. This repository uses its own implementation and does not import either project's dependencies. The original sales pilot projector remains available alongside the engagement workflow.

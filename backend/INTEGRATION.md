# Verified PayPal Sandbox engagement

On November 12, 2026, one synthetic engagement completed the deployed contact-to-kickoff workflow using real Ollama inference, Prisma Compute, Prisma Postgres, and PayPal Sandbox. No live funds or real repository access were involved.

Runtime source: `8ca28814b4c7541815150fdb58cfdf049e6212b0`.

| Transition | Observed evidence |
| --- | --- |
| Contact | Synthetic buyer saved in Prisma Postgres. |
| AI draft | Local `llama3.1:8b` proposed work, quoted `example/demo` and the passing GitHub Actions baseline, and flagged the absent approver. The hosted service validated the exact source quotes. |
| Reviewed scope | Operator supplied the approver, next step, and contact point. Version `scope-56265ecbf45179905be05cd62e4adcad` binds the reviewed terms. |
| Buyer acceptance | Hosted buyer page recorded acceptance of that exact version. This proves possession of the private buyer link, not independent identity verification. |
| Invoice | PayPal created and sent Sandbox invoice `INV2-8QE7-U28H-42AQ-ZBA4` for $625 USD. |
| Access | Operator recorded an explicitly synthetic access attestation; no real repository access was granted. |
| Partial payment | Buyer paid $250. Verified event `WH-7N378916JY213903D-9RD57649GL138762M` caused the backend to fetch the invoice and record `PARTIALLY_PAID`, 25,000 cents, and `ready: false`. |
| Full payment | Buyer paid the remaining $375. Verified event `WH-08314411FJ9016138-9CW74397TD1980908` caused a fresh invoice fetch, which reconciled two distinct PayPal payment IDs totaling 62,500 cents in USD with status `PAID`. Readiness became true. |
| Kickoff | Operator confirmed kickoff through the rendered interface. Receipt `6fbb0fd0-9214-440a-aadb-7a24900dd47e` is preserved in Prisma. |
| Buyer confirmation | The hosted page displayed the buyer, accepted work and version, invoice, both payment IDs, next step, contact point, and confirmation time. An authenticated state read and buyer capability read returned identical confirmation data. |

The provider payment IDs are `2TU62395DX224891A` and `9NP824929W4881707`. They are Sandbox receipts. The app did not use a manual mark-paid endpoint or an operator payment attestation. The two observed webhook events both use `INVOICING.INVOICE.PAID`; the different fetched invoice states determine whether the gate opens.

Prisma preserves ten ordered transition records for the case, including the partial-payment hold and later full-payment verification. Kickoff confirmation snapshots its original payment receipt so a later refund can suspend readiness without rewriting that historical receipt.

## Reproduction and saved evidence

Follow the [local operator instructions](../demo/README.md) and [backend setup](README.md) with your own Sandbox app and synthetic buyer. Capture the same engagement first after a partial payment and again after full settlement. Never substitute the fixture tests for those provider checks.

The Revenue release directory contains private JSON artifacts:

- `paypal-sent-invoice-evidence.json`
- `paypal-partial-payment-evidence.json`
- `paypal-kickoff-confirmed-evidence.json`

The final check independently fetched PayPal's invoice, required two distinct receipts totaling $625, checked the expected invoice and scope, required `kickoff-confirmed` and ten history entries, and compared operator and buyer confirmation objects. The artifacts exclude credentials and the buyer capability.

## Remaining boundaries

This verifies one real Sandbox integration case. It does not establish production-payment readiness, verified buyer identity, real delivery access, or AI extraction accuracy beyond the observed inquiry. AI inference currently runs locally through Ollama; the hosted backend persists and validates its submitted output. The public demo video and hackathon submission were not completed, and the deadline was missed.

# Scope to Deposit

An operator demo for independent consultants. The example engagement is a $1,250 GitHub Repository Hardening Sprint with a $625 deposit.

## Run locally

1. Install Bun and Ollama. Install the Ollama model with `ollama pull llama3.1:8b`, then start Ollama with `OLLAMA_HOST=127.0.0.1:11435 ollama serve`.
2. Run `bun server.ts` from this directory and open `http://127.0.0.1:4178`. AI drafting and scope review are available immediately. The app stores one synthetic case in `demo.sqlite`. Set `DEMO_DB` to a new file for another case.
3. For payment, configure a PayPal Sandbox REST application and a separate sandbox buyer. Copy `.env.example` to `.env.local`, restrict its permissions with `chmod 600 .env.local`, and start the app to open the separate webhook listener on port 4185. Forward HTTPS traffic to the webhook listener only. For a temporary test, run `cloudflared tunnel --url http://127.0.0.1:4185` and register its HTTPS URL with the path `/webhooks/paypal` in the Sandbox application. Subscribe to `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.REFUNDED`, and `INVOICING.INVOICE.CANCELLED`. Set the Sandbox app credentials and webhook ID in `.env.local`, restart the app, and run `bun preflight.ts YOUR_HTTPS_WEBHOOK_URL` to check the registration and listener. Keep the operator screen on port 4178 on loopback.
4. Draft the sample scope, confirm the repository, approver, and baseline, and open the buyer scope link in a separate browser tab and accept the displayed version as the synthetic buyer. Back in the operator screen, record a synthetic repository access reference. Draft the $625 invoice for the sandbox buyer, approve sending by share link, and open the sandbox invoice as that buyer.
5. Pay $250, then check that the case remains on hold after the verified webhook. Pay the remaining $375 and check that the same case changes to ready to schedule after PayPal reports the exact deposit paid.

The app uses PayPal's signature verification endpoint and then fetches the tracked invoice. It stores the webhook ID and reconciled case together. Only the matching $625 USD invoice with unique PayPal transactions totaling $625 and a provider status of `PAID` can satisfy the deposit gate. The buyer accepts through a version-bound local link. The operator records access as an attestation. The link is a demo capability and represents possession of the link rather than verified buyer identity.

Run `bun test paypal.test.ts ../model.test.ts` for the fixture and decision-model tests. The demo uses separate local storage and the Sandbox API host. Use synthetic inquiries and sandbox accounts.

- [PayPal Invoicing API](https://developer.paypal.com/api/invoicing/v2/)
- [PayPal Webhooks API](https://developer.paypal.com/api/webhooks/v1/)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

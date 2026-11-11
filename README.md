# Scope to Deposit

Know when you can schedule a client’s kickoff. Scope to Deposit combines AI-assisted scope review, buyer acceptance of a specific version, and PayPal Sandbox invoice reconciliation. The example is a $1,250 GitHub Repository Hardening Sprint with a $625 deposit.

[Run the demo locally](demo/README.md) with Bun, Ollama, and a PayPal Sandbox app. The example data is synthetic. Run the decision and payment adapter tests with `bun test demo/paypal.test.ts model.test.ts`.

The original sales pilot modeled acceptance, deposits, and kickoff as evidence checks. The hackathon demo adds local AI drafting, separate operator and buyer screens, a dedicated webhook listener, and Sandbox invoice creation and reconciliation.

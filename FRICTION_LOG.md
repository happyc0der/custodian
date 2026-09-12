# Friction log — Custodian (Alexa+ MCP add-on)

Kept live during development for the hackathon's product-feedback requirement. Each entry: what we were doing, what got in the way, what we did about it.

| # | Date | Area | Friction | Workaround / suggestion |
|---|------|------|----------|-------------------------|
| 1 | 2026-09-11 | Tooling | `npm install -g @alexa-ai/cli` fails with 404 on the public npm registry; the docs only reveal on the *Set Up Your Development Environment* page that the package lives in a private AWS CodeArtifact repo that needs an AWS account, the AWS CLI and a named `alexa-ai` profile. | Surface the CodeArtifact requirement on the Quickstart itself and consider publishing the CLI publicly. |
| 2 | 2026-09-11 | Docs | The MCP Toolkit overview's navigation links resolve to `developer.amazon.com/en-US/docs/alexa/add-ons/...` which 404s; the working pages are under `/docs/alexaplus/add-ons/`. | Fix the nav hrefs. |
| 3 | 2026-09-11 | Spec drift | Alexa+ docs require MCP `2025-11-25`, but the *Client and App Lifecycle* page shows the Alexa client sending `protocolVersion: "2025-03-26"` on `initialize`. Meanwhile the current TypeScript SDK (v2) implements `2026-07-28` and *removed* the experimental tasks feature that 2025-11-25 introduced. | Document which client protocol version Alexa actually negotiates and which optional features (elicitation, tasks, sampling) it supports. We designed around `tools/call` + MCP Apps only. |
| 4 | 2026-09-11 | Data | NHTSA's child-seat recall endpoint isn't documented alongside the vehicle one; `api.nhtsa.gov/childSeats?issueType=r` works but `recalls/childSeats` returns an API-Gateway "Missing Authentication Token". | n/a (external), noted for other builders. |
| 5 | 2026-09-11 | Auth | Alexa+ requires a two-tier OAuth model (`client_credentials` + auth-code PKCE) with no DCR and no `WWW-Authenticate` — a different shape from what generic MCP OAuth libraries emit. | A reference authorization-server implementation (or a conformance script) in the toolkit would save every builder a day. |
